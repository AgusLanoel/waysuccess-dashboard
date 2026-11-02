-- Detalle por persona para el bot de Telegram (dueño 02-11): escribe "Luca" y recibe el mensaje listo para reenviar.
create or replace function public.control_cierre_persona(p_nombre text, p_ahora timestamptz default now())
returns text language plpgsql security definer set search_path = public as $fn$
declare
  tz constant text := 'America/Argentina/Buenos_Aires';
  buscado text := translate(lower(trim(coalesce(p_nombre, ''))), 'áéíóúüñ', 'aeiouun');
  candidatos text[]; persona text; msg text; r record; n int; total int; lista text;
begin
  create temp table if not exists _cp on commit drop as select * from control_cierre_core(p_ahora) limit 0;
  truncate _cp;
  insert into _cp select * from control_cierre_core(p_ahora);

  -- Personas válidas: equipo activo + quien tenga pendientes (Ale, "Sin closer").
  select array_agg(x order by x) into candidatos from (
    select name x from comercial_team where active and role in ('closer', 'setter')
    union select responsable from _cp) c
  where translate(lower(x), 'áéíóúüñ', 'aeiouun') = buscado;
  if candidatos is null and buscado <> '' then
    select array_agg(x order by x) into candidatos from (
      select name x from comercial_team where active and role in ('closer', 'setter')
      union select responsable from _cp) c
    where translate(lower(x), 'áéíóúüñ', 'aeiouun') like buscado || '%';
  end if;

  if candidatos is null or cardinality(candidatos) <> 1 then
    select string_agg(x, ', ' order by x) into lista from (
      select name x from comercial_team where active and role in ('closer', 'setter')
      union select responsable from _cp) c;
    return 'No encontré a "' || trim(coalesce(p_nombre, '')) || E'".\nEscribí uno de estos nombres: ' || lista || E'.\nO "general" para ver el resumen.';
  end if;
  persona := candidatos[1];

  select count(*) into total from _cp where responsable = persona;
  if total = 0 then
    return '✅ ' || persona || ' está al día: no tiene nada pendiente en el CRM.';
  end if;

  msg := persona || ', esto te falta actualizar en el CRM (' || total || ' pendientes al '
      || to_char(p_ahora at time zone tz, 'DD-MM HH24:MI') || E'):\n';

  for r in
    select * from (values
      (1, 'sin_contactar', 'Contactar y mover a "Agenda Contactada" (o "Llamada Confirmada" si confirmó)'),
      (2, 'sin_confirmar', 'Confirmar la asistencia y mover a "Llamada Confirmada"'),
      (3, 'sin_resultado', 'La llamada ya pasó y no tiene resultado. Mover a P1/P3/P5/Reserva/Cerrado si asistió, a No Show si no vino, o reagendar y cancelar la cita vieja. Si asistió, completar ¿Asistió?, Oferta, Calificación closer y ¿Se realizó la oferta?'),
      (4, 'faltan_datos', 'Completar estos campos en la oportunidad'),
      (5, 'perdida_sin_motivo', 'Cargar el Motivo de pérdida'),
      (6, 'sin_oportunidad', 'Tuvieron llamada pero no tienen oportunidad en el pipeline: crearla y cargar el resultado')
    ) t(orden, tipo, instruccion) order by orden
  loop
    select count(*),
           string_agg('• ' || nombre || coalesce(' (' || producto || ')', '') || ' — ' ||
             case r.tipo
               when 'sin_contactar' then replace(detalle, 'Sin contactar. Llamada: ', 'llamada ')
               when 'sin_confirmar' then replace(detalle, 'Contactada sin confirmar. Llamada: ', 'llamada ')
               when 'sin_resultado' then 'llamada ' || to_char(referencia at time zone tz, 'DD-MM HH24:MI')
               when 'faltan_datos' then replace(detalle, 'Falta: ', '')
               when 'perdida_sin_motivo' then 'perdida el ' || to_char(referencia at time zone tz, 'DD-MM')
               else 'llamada ' || to_char(referencia at time zone tz, 'DD-MM HH24:MI')
             end, E'\n' order by referencia)
      into n, lista from _cp where responsable = persona and tipo = r.tipo;
    if n > 0 then
      msg := msg || E'\n' || r.instruccion || ' (' || n || E'):\n' || lista || E'\n';
    end if;
  end loop;
  return rtrim(msg, E'\n');
end $fn$;
revoke all on function public.control_cierre_persona(text, timestamptz) from public, anon, authenticated;

-- El aviso de las 21 h suma la línea: "Escribí un nombre acá (ej: Luca) para ver qué decirle." antes de "Ver detalle:" (aplicado en vivo sobre control_cierre_aviso).
