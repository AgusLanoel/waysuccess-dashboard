-- Bot de cierre de día para el equipo (dueño 02-11): acceso por invitación de un solo uso.
create table if not exists public.control_bot_miembros (
  chat_id bigint primary key,
  nombre text not null,
  rol text not null default 'miembro' check (rol in ('owner', 'miembro')),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create table if not exists public.control_bot_invitaciones (
  codigo text primary key,
  nombre text not null,
  expira_en timestamptz not null default now() + interval '7 days',
  usado_en timestamptz,
  usado_por bigint
);
alter table public.control_bot_miembros enable row level security;
alter table public.control_bot_invitaciones enable row level security;
revoke all on public.control_bot_miembros, public.control_bot_invitaciones from public, anon, authenticated;
-- El dueño se cargó desde settings.control_crm_chat (rol owner).
-- control_cierre_aviso: p_url null = sin el enlace al dashboard (los miembros no tienen esa pestaña).
