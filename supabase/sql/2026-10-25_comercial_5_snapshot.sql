-- Comercial 5: foto (snapshot) de las vistas comerciales en tablas, refrescada al final de cada sync-ghl.
-- Las vistas con permisos por fila tardaban ~50 s dentro de las funciones; las tablas responden al instante.
create table if not exists public.com_opps_snap as select * from public.v_com_opps with no data;
create table if not exists public.com_calls_snap as select * from public.v_com_calls_todas with no data;
create table if not exists public.com_agendas_snap as select * from public.v_com_agendas with no data;
alter table public.com_opps_snap enable row level security;
alter table public.com_calls_snap enable row level security;
alter table public.com_agendas_snap enable row level security;
create policy "solo miembros" on public.com_opps_snap for select using ((select is_member()));
create policy "solo miembros" on public.com_calls_snap for select using ((select is_member()));
create policy "solo miembros" on public.com_agendas_snap for select using ((select is_member()));
revoke all on public.com_opps_snap, public.com_calls_snap, public.com_agendas_snap from anon;

create or replace function public.refresh_comercial() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from com_opps_snap; insert into com_opps_snap select * from v_com_opps;
  delete from com_calls_snap; insert into com_calls_snap select * from v_com_calls_todas;
  delete from com_agendas_snap; insert into com_agendas_snap select * from v_com_agendas;
  insert into settings (key, value, note) values ('comercial_refresh', to_jsonb(now()), 'Última foto de los datos comerciales (refresh_comercial)')
  on conflict (key) do update set value = excluded.value;
end $$;
revoke execute on function public.refresh_comercial() from public, anon, authenticated;
grant execute on function public.refresh_comercial() to service_role;
select public.refresh_comercial();

create or replace function public.comercial(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = public as $$
with
prev as (select p_from - (p_to - p_from + 1) f, p_from - 1 t),
calls as (select * from com_calls_snap),
agendas as (select * from com_agendas_snap),
opps as (select * from com_opps_snap),
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

create or replace function public.comercial_empresa(p_from date, p_to date, p_producto text default 'Todos') returns jsonb
language sql stable security invoker set search_path = public as $$
with
periodos as (select p_from f, p_to t, 'actual' periodo union all select p_from - (p_to - p_from + 1), p_from - 1, 'anterior'),
grupos(grupo, orden, fuentes) as (values
  ('Comercial', 1, null::text[]), ('Marketing', 2, array['Ads', 'Orgánico']), ('Ads', 3, array['Ads']),
  ('Orgánico', 4, array['Orgánico']), ('Referidos', 5, array['Referidos']), ('Afiliados', 6, array['Afiliados'])),
ag as materialized (select * from com_agendas_snap where p_producto = 'Todos' or producto = p_producto),
ca as materialized (select * from com_calls_snap where p_producto = 'Todos' or producto = p_producto),
op as materialized (select o.*, coalesce(case o.producto when 'JessiK' then t.comm_jessik else t.comm_dfy end, 0) pct
       from com_opps_snap o left join comercial_team t on t.name = o.closer
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
