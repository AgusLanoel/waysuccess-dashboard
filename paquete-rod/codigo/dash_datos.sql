-- 14-11-2026 · Rediseño del dashboard: UNA sola foto de datos crudos desde FECHA_INICIO_DATOS (2026-10-01).
-- Todas las métricas se calculan en web/src/lib/metricas.ts (capa de métricas única). Acá solo se juntan filas.
-- Permisos: owner/finanzas ven todo; un closer ve solo sus filas (mismo criterio que la RLS "por closer").

-- Comisión 3% para DFY y JessiK (confirmado por Luca, 11-11). Antes JessiK = 5%.
update comercial_team set comm_jessik = 0.03 where comm_jessik = 0.05;

-- Tier setter = misma regla que la columna P "Tier setter" del Tracker:
-- primer monto con k/m de la facturación; ≥250k S, ≥50k A, ≥20k B, ≥5k C; "Menos de…" = sin tier.
create or replace function public.dash_tier(t text) returns text language sql immutable set search_path = '' as $$
  select case
    when t is null or t ~* 'menos de' then null
    else (select case when k >= 250 then 'S' when k >= 50 then 'A' when k >= 20 then 'B' when k >= 5 then 'C' end
          from (select case when m[2] ilike 'm' then m[1]::numeric * 1000 else m[1]::numeric end k
                from regexp_match(lower(t), '([0-9]+)\s*([km])') m) x)
  end
$$;

create or replace function public.dash_closer(t text) returns text language sql immutable set search_path = '' as $$
  select case
    when t is null or btrim(t) = '' then null
    when lower(btrim(t)) in ('milesi', 'mileses', 'mileces') then 'Mileces'
    when lower(btrim(t)) in ('alessandro', 'ale') then 'Ale'
    else initcap(btrim(t))
  end
$$;

create or replace function public.dash_persona(email text, phone text, fallback text) returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(lower(btrim(email)), ''),
                  nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), ''),
                  fallback)
$$;

create or replace function public.dash_datos()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  desde date := dashboard_desde();
  todo boolean := ve_todo();
  yo text := my_closer();
  r jsonb;
begin
  if not (is_member() or todo) then return null; end if;
  with
  c as materialized (select id, custom_fields cf, email_norm, phone_norm, date_added, dash_persona(email_norm, phone_norm, id) persona from ghl_contacts),
  -- T0 = primer contacto de la persona (tras la migración del 21-10 cada cliente tiene 2 contactos: vale el más antiguo)
  primer_contacto as materialized (select persona, min(date_added) creado from c group by persona),
  ll as (
    select k.*, dash_persona(c.email_norm, c.phone_norm, k.contact_id) persona, dash_tier(income_answer(c.cf)) tier
    from com_calls_snap k left join c on c.id = k.contact_id
    where k.fecha_llamada >= desde and (todo or k.closer = yo)
  ),
  op as (
    -- persona calculada una vez antes de cruzar (cruzar por la función tardaba 2 s)
    select o.*, dash_tier(income_answer(c.cf)) tier, pc.creado contacto_creado
    from (select o0.*, dash_persona(o0.email, o0.telefono, o0.contact_id) persona from com_opps_snap o0) o
      left join c on c.id = o.contact_id
      left join primer_contacto pc on pc.persona = o.persona
    where (todo or o.closer = yo)
  ),
  ag as (
    select a.*, dash_persona(c.email_norm, c.phone_norm, a.contact_id) persona, dash_tier(income_answer(c.cf)) tier
    from com_agendas_snap a left join c on c.id = a.contact_id
    where a.fecha_agenda >= desde and (todo or a.closer = yo)
  ),
  tl as (
    select fila, datos d, dash_closer(datos->>'Closer') closer from tracker_filas where hoja = 'Llamadas'
  ),
  tc as (
    select fila, datos d, dash_closer(datos->>'Closer') closer from tracker_filas where hoja = 'Cobros'
  )
  select jsonb_build_object(
    'generado', now(),
    'desde', desde,
    'rol', my_role(),
    'closer_fijo', yo,
    'sync', (select jsonb_object_agg(source, last_ok) from sync_status()),
    'equipo', (select jsonb_agg(jsonb_build_object('nombre', name, 'rol', role, 'activo', active, 'comision_dfy', comm_dfy, 'comision_jessik', comm_jessik)) from comercial_team),
    'llamadas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'persona', persona, 'contact_id', contact_id, 'fecha', fecha_llamada, 'inicio', inicio, 'status', status,
        'closer', dash_closer(closer), 'producto', producto, 'asistio', coalesce(asistio, false), 'calificada', coalesce(calificada_closer, false),
        'oferta', coalesce(oferta_hecha, false), 'fuente', fuente, 'tier', tier, 'en_vivo', en_vivo)) from ll), '[]'),
    'opps', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'persona', persona, 'contact_id', contact_id, 'nombre', nombre, 'telefono', telefono, 'email', email,
        'etapa', etapa, 'status', status, 'valor', valor, 'producto', producto, 'closer', dash_closer(closer), 'setter', setter,
        'calificacion', calificacion, 'oferta', oferta_hecha, 'asistio', asistio, 'primera_llamada', primera_llamada,
        'fecha_cierre', fecha_cierre, 'cobrado', cobrado, 'motivo', motivo, 'proximo_seguimiento', proximo_seguimiento,
        'plan_pago', plan_pago, 'metodo_cobro', metodo_cobro, 'saldo_pendiente', saldo_pendiente, 'de_ads', de_ads,
        'creada', created_at, 'contacto_creado', contacto_creado, 'cambio_etapa', last_stage_change_at, 'fuente', fuente,
        'tier', tier, 'historico', historico)) from op
        where status <> 'won' or fecha_cierre >= desde), '[]'),
    'agendas', coalesce((select jsonb_agg(jsonb_build_object(
        'key', agenda_key, 'persona', persona, 'contact_id', contact_id, 'fecha', fecha_agenda, 'producto', producto,
        'fuente', fuente, 'closer', dash_closer(closer), 'tier', tier)) from ag), '[]'),
    -- Tracker (solo lectura). Fuente de: Llamada → pago, objeciones, cobros en seguimiento y metas.
    'tracker', jsonb_build_object(
      'llamadas', coalesce((select jsonb_agg(jsonb_build_object(
          'fila', fila, 'persona', dash_persona(d->>'Correo', d->>'Numero', 'fila-' || fila),
          'fecha', d->>'Fecha LLamada Calendar', 'nombre', d->>'Nombre lead', 'email', d->>'Correo',
          'industria', d->>'Industria', 'facturacion', d->>'Facturación', 'mes', d->>'Mes', 'ingreso', d->>'Fecha de ingreso de cliente__raw',
          'closer', closer, 'setter', d->>'Setter origen', 'pais', d->>'País', 'estado', d->>'Estado / provincia',
          'origen', d->>'Origen de Lead', 'producto', d->>'Producto', 'campana', d->>'Campaña', 'tier', d->>'Tier setter',
          'estado_llamada', d->>'Estado llamada', 'asistencia_calificada', d->>'Asistencia Calificada', 'oferta', d->>'Oferta hecha',
          'resultado', d->>'Resultado', 'bono', d->>'Bono activado', 'modalidad', d->>'Modalidad pago',
          'vendido', d->'$$ Vendido (USD)', 'cobrado', d->'$$ Cobrado (USD)', 'periodo', d->>'Periodo',
          'fecha_primer_pago', d->>'Fecha primer pago', 'ciclo_asistencia', d->>'Ciclo de venta desde asistencia',
          'numero', d->>'Numero', 'cal_agenda', d->>'Calificación histórica (respaldo P)', 'notas', d->>'Notas comerciales',
          'cobranzas', d->>'Cobranzas (USD)',
          'objeciones', (select coalesce(jsonb_agg(substr(k, 5)), '[]') from jsonb_each_text(d) e(k, v)
                         where k like 'obj:%' and v ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' and v::numeric >= 1)))
        from tl where (todo or closer = yo) and (d->>'Fecha LLamada Calendar' >= desde::text or lower(btrim(d->>'Resultado')) = 'vendido')), '[]'),
      'cobros', coalesce((select jsonb_agg(jsonb_build_object(
          'fila', fila, 'fecha', d->>'Fecha de cobro', 'fecha_raw', d->>'Fecha de cobro__raw', 'cliente', d->>'Cliente',
          'email', d->>'Correo', 'fila_llamadas', d->>'Fila Llamadas', 'closer', closer, 'fuente', d->>'Fuente',
          'producto', d->>'Producto', 'tipo', d->>'Tipo de cobro', 'cobrado', d->'Cobrado USD', 'vendido_nuevo', d->'Vendido nuevo USD',
          'observacion', d->>'Observación', 'cobrado_al_cierre', d->'Cobrado al cierre', 'vendido_original', d->'Vendido original',
          'cobrado_acumulado', d->'Cobrado acumulado', 'excedente', d->'Excedente sobre vendido', 'tier', d->>'Tier',
          'industria', d->>'Industria'))
        from tc where todo or closer = yo), '[]'),
      -- 15-11: Cierres — Clientes (lista de cierres del Tracker) + validación geográfica por fila de Llamadas
      'cierres', coalesce((select jsonb_agg(jsonb_build_object(
          'fila', x.fila, 'fecha', x.datos->>'FECHA', 'tipo', x.datos->>'TIPO', 'cliente', x.datos->>'CLIENTE', 'email', x.datos->>'EMAIL',
          'telefono', x.datos->>'TELÉFONO', 'closer', dash_closer(x.datos->>'CLOSER'), 'producto', x.datos->>'PRODUCTO', 'fuente', x.datos->>'FUENTE',
          'vendido', x.datos->'VENDIDO', 'cobrado', x.datos->'COBRADO', 'fecha_original', x.datos->>'FECHA ORIGINAL', 'modalidad', x.datos->>'MODALIDAD',
          'pais', x.datos->>'PAÍS', 'notas', x.datos->>'NOTAS', 'fila_llamadas', x.datos->>'FILA') order by x.fila)
        from tracker_filas x where x.hoja = 'Cierres' and (todo or dash_closer(x.datos->>'CLOSER') = yo)), '[]'),
      'geo', coalesce((select jsonb_agg(jsonb_build_object('fila_llamadas', g.datos->>'Fila Llamadas', 'pais', g.datos->>'País validado',
          'estado', g.datos->>'Estado validado', 'ciudad', g.datos->>'Ciudad validada'))
        from tracker_filas g where g.hoja = 'Geo'), '[]'),
      'proyecciones', case when todo then
        (select jsonb_object_agg(fila::text, datos) from tracker_filas where hoja = 'Proyecciones') end,
      'sincronizado', (select max(synced_at) from tracker_filas)
    )
  ) into r;
  return r;
end $fn$;
revoke all on function public.dash_datos() from public, anon;
grant execute on function public.dash_datos() to authenticated;

-- Equipo · Setters: por setter, por tier y agendas sin contactar (con tier y closer). Mismo criterio que setter().
create or replace function public.setter_equipo(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $fn$
with ag as (
  select v.*, (v.agendada at time zone 'America/Argentina/Buenos_Aires')::date dia,
         case when v.contactada_con_hora then extract(epoch from v.contactada - v.agendada) / 60 end minutos,
         v.status = 'open' and v.etapa in ('Triaje', 'Agenda') and v.contactada is null pendiente,
         coalesce(dash_tier(income_answer(c.custom_fields)), 'Sin tier') tier
  from v_setter_agendas v left join ghl_contacts c on c.id = v.contact_id
  where v.llamada is not null
    and (v.agendada at time zone 'America/Argentina/Buenos_Aires')::date >= (select (value #>> '{}')::date from settings where key = 'setter_desde')
    and (ve_todo() or v.closer = my_closer())
),
per as (select * from ag where dia between p_from and p_to),
agg as (
  select grupo, clave,
    count(*) agendas,
    count(*) filter (where contactada is not null) contactadas,
    count(*) filter (where contactada is not null and (llamada is null or contactada <= llamada)) contactadas_antes,
    round(percentile_cont(0.5) within group (order by minutos) filter (where minutos >= 0)) mediana_min,
    count(*) filter (where llamada < now() and contactada is not null) pasadas_contactadas,
    count(*) filter (where llamada < now() and contactada is not null and asistio) asist_contactadas,
    count(*) filter (where llamada < now() and contactada is null) pasadas_no_contactadas,
    count(*) filter (where llamada < now() and contactada is null and asistio) asist_no_contactadas
  from (select 'setter' grupo, coalesce(setter, 'Sin asignar') clave, * from per
        union all select 'tier', tier, * from per
        union all select 'total', 'Total', * from per) x
  group by grupo, clave
)
select jsonb_build_object(
  'desde', (select value #>> '{}' from settings where key = 'setter_desde'),
  'filas', (select coalesce(jsonb_agg(to_jsonb(a) order by a.grupo, a.agendas desc), '[]') from agg a),
  'pendientes', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'contact_id', a.contact_id, 'nombre', a.nombre, 'telefono', a.telefono, 'producto', a.producto, 'tier', a.tier,
      'closer', dash_closer(a.closer), 'etapa', a.etapa, 'agendada', a.agendada, 'llamada', a.llamada,
      'horas_esperando', round(extract(epoch from now() - a.agendada) / 3600, 1)) order by a.llamada nulls last), '[]')
    from ag a where a.pendiente)
)
where is_member() or ve_todo();
$fn$;
grant execute on function public.setter_equipo(date, date) to authenticated;
