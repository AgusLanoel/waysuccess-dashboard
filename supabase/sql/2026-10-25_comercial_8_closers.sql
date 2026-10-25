-- Comercial 8: dashboards por closer. Un closer ve solo lo suyo (en la base, no solo en pantalla); owner y finanzas ven todo.

create or replace function public.my_closer() returns text
language sql stable security definer set search_path = public as $$
  select closer_name from dashboard_members where user_id = auth.uid() and role = 'closer';
$$;
create or replace function public.ve_todo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'role', '') not in ('authenticated', 'anon')
      or exists (select 1 from dashboard_members where user_id = auth.uid() and role in ('owner', 'finanzas'));
$$;
revoke execute on function public.my_closer(), public.ve_todo() from public, anon;
grant execute on function public.my_closer(), public.ve_todo() to authenticated;

-- La fecha de corte la leen todos (settings tiene datos que un closer no necesita)
create or replace function public.comercial_corte() returns date
language sql stable security definer set search_path = public as $$ select (value #>> '{}')::date from settings where key = 'comercial_corte' $$;

-- Agendas con el closer asignado a la cita
create or replace view public.v_com_agendas with (security_invoker = true) as
select a.contact_id,
       (a.date_added at time zone 'America/Argentina/Buenos_Aires')::date fecha_agenda,
       case when is_jessik(c.custom_fields) then 'JessiK' when is_qualified(c.custom_fields) then 'DFY' else 'Sin definir' end producto,
       a.calendar_id = '7SNm0NGnthgEIWCbOf05' en_vivo,
       fuente_contacto(c.custom_fields, ca.is_paid and not ca.other_account) fuente,
       t.name closer
from ghl_appointments a
left join ghl_contacts c on c.id = a.contact_id
left join v_contact_attribution ca on ca.contact_id = a.contact_id
left join comercial_team t on t.ghl_user_id = a.assigned_user_id
where not a.deleted
  and ((a.calendar_id = '7SNm0NGnthgEIWCbOf05' and a.date_added >= comercial_corte())
    or (a.calendar_id in ('aLqJG1EY9LmXyuWh6lJE', 'l6nDyuqheYOmLWu813Ez') and a.date_added < comercial_corte()));
alter table public.com_agendas_snap add column if not exists closer text;

-- Fotos comerciales: cada closer ve sus filas
do $$
declare t text;
begin
  foreach t in array array['com_opps_snap', 'com_calls_snap', 'com_agendas_snap'] loop
    execute format('drop policy if exists "solo miembros" on public.%I', t);
    execute format('drop policy if exists "por closer" on public.%I', t);
    execute format('create policy "por closer" on public.%I for select using ((select ve_todo()) or closer = (select my_closer()))', t);
  end loop;
end $$;

-- Datos crudos de GHL y la hoja: solo owner y finanzas (los closers usan las fotos y Mi día)
do $$
declare t text;
begin
  foreach t in array array['ghl_opportunities', 'ghl_contacts', 'ghl_appointments', 'ghl_opportunity_events', 'sheet_calls'] loop
    execute format('drop policy if exists "solo miembros" on public.%I', t);
    execute format('drop policy if exists "owner y finanzas" on public.%I', t);
    execute format('create policy "owner y finanzas" on public.%I for select using ((select ve_todo()))', t);
  end loop;
end $$;

-- comercial(): un closer solo se ve a sí mismo en la tabla de closers
do $$
declare d text;
begin
  d := pg_get_functiondef('public.comercial(date,date)'::regprocedure);
  if position('select * from closers where active or llamadas > 0 or cierres > 0' in d) = 0 then raise exception 'patrón no encontrado'; end if;
  d := replace(d, 'select * from closers where active or llamadas > 0 or cierres > 0',
                  'select * from closers where (active or llamadas > 0 or cierres > 0) and (my_closer() is null or closer = my_closer())');
  execute d;
end $$;

-- Mi día: llamadas de hoy y mañana, seguimientos y pendientes de un closer.
-- Un closer recibe siempre lo suyo; owner/finanzas eligen closer con p_closer (null = todos).
create or replace function public.mi_dia(p_closer text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c text := my_closer();
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if c is null then
    if not ve_todo() then return null; end if;
    c := p_closer;
  end if;
  return jsonb_build_object(
    'closer', c,
    'hoy', hoy,
    'llamadas', (
      select coalesce(jsonb_agg(x order by x.inicio), '[]') from (
        select a.id, a.contact_id, t.name closer, a.start_time inicio,
               to_char(a.start_time at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') hora,
               (a.start_time at time zone 'America/Argentina/Buenos_Aires')::date dia,
               coalesce(o.nombre, ct.email_norm) nombre, ct.phone_norm telefono, ct.email_norm email,
               o.etapa, coalesce(o.producto, case when is_jessik(ct.custom_fields) then 'JessiK' when is_qualified(ct.custom_fields) then 'DFY' else 'Sin definir' end) producto,
               o.fuente, income_answer(ct.custom_fields) ingresos, ct.custom_fields ->> 'Zx82M03hxVfg98NtIvGD' negocio, a.status
        from ghl_appointments a
        join comercial_team t on t.ghl_user_id = a.assigned_user_id
        left join ghl_contacts ct on ct.id = a.contact_id
        left join lateral (select * from com_opps_snap s where s.contact_id = a.contact_id order by s.created_at desc limit 1) o on true
        where a.calendar_id = '7SNm0NGnthgEIWCbOf05' and not a.deleted and a.status not in ('cancelled', 'invalid')
          and (a.start_time at time zone 'America/Argentina/Buenos_Aires')::date between hoy and hoy + 1
          and (c is null or t.name = c)
      ) x),
    'seguimientos', (
      select coalesce(jsonb_agg(x order by x.proximo_seguimiento nulls first), '[]') from (
        select o.id, o.contact_id, o.nombre, o.telefono, o.closer, o.etapa, o.producto, o.motivo, o.proximo_seguimiento, o.historico
        from com_opps_snap o
        where o.status = 'open' and o.id not like 'hoja-%'
          and o.etapa in ('P1 - No tiene interés en este momento', 'P3 - Interés pero no puede ahora', 'P5 - Compra este mes', 'Reserva', '2da Llamada Agenda')
          and (o.proximo_seguimiento is null or o.proximo_seguimiento <= hoy + 7)
          and (c is null or o.closer = c)
      ) x),
    'pendientes', (
      select coalesce(jsonb_agg(x order by x.problema, x.nombre), '[]') from (
        select o.id, o.contact_id, o.nombre, o.closer, o.etapa, o.historico, p.problema
        from com_opps_snap o
        cross join lateral (values
          (case when o.status = 'open' and not o.historico and o.etapa in ('Triaje', 'Agenda', 'Llamada Confirmada') and o.primera_llamada < hoy then 'La llamada ya pasó: mover la etapa' end),
          (case when o.status = 'open' and not o.historico and o.primera_llamada < hoy and o.producto = 'Sin definir' then 'Falta Oferta (DFY o JessiK)' end),
          (case when o.status = 'open' and not o.historico and o.primera_llamada < hoy and o.calificacion is null and o.asistio then 'Falta Calificación closer' end),
          (case when o.status = 'open' and o.etapa like 'P_ - %' and o.motivo is null then 'Seguimiento sin motivo' end),
          (case when o.status = 'open' and o.etapa like 'P_ - %' and o.proximo_seguimiento is null then 'Seguimiento sin fecha' end),
          (case when o.status = 'won' and o.id not like 'hoja-%' and (o.valor <= 0 or not o.fecha_cierre_cargada or o.cobrado <= 0) then 'Venta incompleta: valor, fecha de cierre o cobrado' end),
          (case when o.status = 'lost' and o.motivo is null then 'Perdida sin motivo' end)
        ) p(problema)
        where p.problema is not null and o.id not like 'hoja-%' and (c is null or o.closer = c)
      ) x)
  );
end $$;
revoke execute on function public.mi_dia(text) from public, anon;
grant execute on function public.mi_dia(text) to authenticated;

select public.refresh_comercial();
