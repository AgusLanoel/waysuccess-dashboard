-- 2026-10-28 ads_show_rate: cuenta PERSONAS por día, no citas. Si alguien reagenda sin cancelar (dos citas
-- el mismo día) cuenta una sola vez; canceladas e inválidas siguen fuera. Persona = email, teléfono o contacto.
create or replace function public.ads_show_rate(p_from date, p_to date)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with k as (
    select k.fecha_llamada, k.inicio, k.asistio,
           coalesce(nullif(c.email_norm, ''), nullif(c.phone_norm, ''), k.contact_id) persona
    from com_calls_snap k left join ghl_contacts c on c.id = k.contact_id
    where k.fuente = 'Ads' and k.producto in ('DFY', 'JessiK') and k.status not in ('cancelled', 'invalid')
      and k.fecha_llamada between p_from and p_to
  ), p as (
    select fecha_llamada, persona, min(inicio) inicio, bool_or(coalesce(asistio, false)) asistio
    from k group by fecha_llamada, persona
  )
  select case when is_owner() then jsonb_build_object(
    'pasadas', count(*) filter (where p.inicio < now()),
    'asistencias', count(*) filter (where p.inicio < now() and p.asistio),
    'por_venir', count(*) filter (where p.inicio >= now()))
  end
  from p
$function$;
