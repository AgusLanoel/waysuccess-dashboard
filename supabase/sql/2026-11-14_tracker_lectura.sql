-- 14-11-2026 · Tracker Comercial en solo lectura (edge fn tracker-read, cron cada 15 min).
-- Decisión del dueño: ventas siempre de GHL; el Tracker solo para bloques "fuente: Tracker".
create table if not exists public.tracker_filas (
  hoja text not null,          -- 'Llamadas' | 'Cobros' | 'Proyecciones'
  fila int not null,           -- número de fila real en el Sheet
  datos jsonb not null,        -- {encabezado: valor}; fechas ya en yyyy-mm-dd (+ campo "__raw")
  synced_at timestamptz not null default now(),
  primary key (hoja, fila)
);
alter table public.tracker_filas enable row level security;
-- Solo owner/finanzas leen directo; el resto pasa por las funciones del dashboard.
drop policy if exists tracker_filas_lectura on public.tracker_filas;
create policy tracker_filas_lectura on public.tracker_filas for select using ((select public.ve_todo()));

create or replace function public.tracker_reemplazar(p_filas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_array_length(p_filas) < 10 then raise exception 'Lectura del Tracker sospechosa (% filas): no se reemplaza', jsonb_array_length(p_filas); end if;
  delete from tracker_filas where true;
  insert into tracker_filas (hoja, fila, datos)
  select f->>'hoja', (f->>'fila')::int, f->'datos' from jsonb_array_elements(p_filas) f;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.tracker_reemplazar(jsonb) from public, anon, authenticated;

select cron.schedule('tracker-read', '*/15 * * * *', $$select private.call_fn('tracker-read')$$);
