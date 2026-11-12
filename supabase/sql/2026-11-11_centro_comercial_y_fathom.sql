-- 11-11-2026 dueño: pestaña "Centro comercial" (recursos + tareas) y llamadas de Fathom que actualizan la oportunidad.
-- Recursos y tareas: los ven todos los miembros del dashboard; solo los owners los editan.

-- 1) Recursos: contratos, links de pago, scripts, entregables a los leads
create table if not exists public.com_recursos (
  id bigserial primary key,
  categoria text not null check (categoria in ('Contratos', 'Links de pago', 'Scripts', 'Entregables a los leads', 'Otros')),
  titulo text not null,
  url text,
  nota text,
  orden int not null default 100,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.com_recursos enable row level security;
drop policy if exists recursos_leer on public.com_recursos;
create policy recursos_leer on public.com_recursos for select to authenticated using (public.is_member());
drop policy if exists recursos_editar on public.com_recursos;
create policy recursos_editar on public.com_recursos for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- 2) Tareas del área comercial
create table if not exists public.com_tareas (
  id bigserial primary key,
  titulo text not null,
  detalle text,
  estado text not null default 'Pendiente' check (estado in ('Pendiente', 'En curso', 'Hecho', 'Bloqueado')),
  responsable text,
  orden int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.com_tareas enable row level security;
drop policy if exists tareas_leer on public.com_tareas;
create policy tareas_leer on public.com_tareas for select to authenticated using (public.is_member());
drop policy if exists tareas_editar on public.com_tareas;
create policy tareas_editar on public.com_tareas for all to authenticated using (public.is_owner()) with check (public.is_owner());

create or replace function public.tg_touch_updated() returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select coalesce(display_name, '') from dashboard_members where user_id = auth.uid()), new.updated_by);
  return new;
end $$;
drop trigger if exists touch on public.com_recursos;
create trigger touch before insert or update on public.com_recursos for each row execute function public.tg_touch_updated();
drop trigger if exists touch on public.com_tareas;
create trigger touch before insert or update on public.com_tareas for each row execute function public.tg_touch_updated();

-- 3) Fathom: un webhook por persona que graba (closer). El secreto verifica la firma de cada envío.
create table if not exists public.fathom_webhooks (
  id text primary key,                -- id del webhook en Fathom
  persona text not null,              -- nombre en comercial_team (Luca, Jenny, …)
  email text,                         -- email de la cuenta de Fathom
  secret text not null,               -- whsec_… (solo lo lee la función, sin permisos para el dashboard)
  creado_at timestamptz not null default now()
);
alter table public.fathom_webhooks enable row level security;   -- sin políticas: solo service role

-- 4) Llamadas grabadas: transcripción + lo que la IA extrajo + qué se escribió en GHL
create table if not exists public.fathom_calls (
  id text primary key,                -- url/recording id de Fathom
  persona text,                       -- quién grabó
  titulo text,
  share_url text,
  inicio timestamptz,
  fin timestamptz,
  invitados jsonb,
  contact_id text,
  opp_id text,
  lead_nombre text,
  transcript jsonb,
  resumen text,
  ia jsonb,                           -- {asistio, oferta_hecha, resultado, etapa_sugerida, motivo, proxima_llamada_acordada, proximo_seguimiento, monto, plan_pago, resumen_corto}
  proxima_llamada_acordada boolean,
  proximo_seguimiento timestamptz,    -- cuándo quedaron en volver a hablar (según la transcripción)
  estado text not null default 'recibida', -- recibida | sin_lead | procesada | ghl_ok | error
  error text,
  ghl_escrito jsonb,
  revisada_cita_at timestamptz,       -- chequeo de los 10 minutos
  recibida_at timestamptz not null default now()
);
alter table public.fathom_calls enable row level security;
drop policy if exists fathom_calls_leer on public.fathom_calls;
create policy fathom_calls_leer on public.fathom_calls for select to authenticated
  using (public.is_owner() or (public.my_closer() is not null and persona = public.my_closer()));

-- 5) Alertas comerciales: próxima llamada sin agendar, seguimientos del día, etc.
create table if not exists public.com_alertas (
  id bigserial primary key,
  tipo text not null,                 -- proxima_llamada_sin_agendar | seguimiento_hoy | …
  persona text,                       -- closer al que corresponde
  para text,                          -- a quién se avisó (Laura, closer)
  contact_id text,
  opp_id text,
  lead_nombre text,
  mensaje text not null,
  fathom_call_id text,
  creada_at timestamptz not null default now(),
  enviada_at timestamptz,
  resuelta_at timestamptz,
  unique (tipo, fathom_call_id)
);
alter table public.com_alertas enable row level security;
drop policy if exists alertas_leer on public.com_alertas;
create policy alertas_leer on public.com_alertas for select to authenticated
  using (public.is_owner() or (public.my_closer() is not null and persona = public.my_closer()));
drop policy if exists alertas_resolver on public.com_alertas;
create policy alertas_resolver on public.com_alertas for update to authenticated
  using (public.is_owner() or (public.my_closer() is not null and persona = public.my_closer()));

grant select, insert, update, delete on public.com_recursos, public.com_tareas to authenticated;
grant usage, select on sequence public.com_recursos_id_seq, public.com_tareas_id_seq to authenticated;
grant select on public.fathom_calls to authenticated;
grant select, update on public.com_alertas to authenticated;
