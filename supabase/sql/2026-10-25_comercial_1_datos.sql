-- Comercial fase 1: datos de oportunidades (campos de GHL + historial de etapas), equipo, y Ads solo para rol owner.

-- 1) Oportunidades: campos que faltaban
alter table public.ghl_opportunities
  add column if not exists name text,
  add column if not exists assigned_to text,
  add column if not exists cf jsonb not null default '{}'::jsonb,
  add column if not exists lost_reason_id text,
  add column if not exists last_stage_change_at timestamptz,
  add column if not exists last_status_change_at timestamptz;

-- 2) Historial: cada cambio de etapa o estado que ve la sincronización
create table if not exists public.ghl_opportunity_events (
  id bigserial primary key,
  opp_id text not null,
  at timestamptz not null,
  kind text not null check (kind in ('created', 'stage', 'status')),
  from_val text,
  to_val text,
  recorded_at timestamptz not null default now()
);
create index if not exists ghl_opportunity_events_opp on public.ghl_opportunity_events (opp_id, at);
alter table public.ghl_opportunity_events enable row level security;
create policy "solo miembros" on public.ghl_opportunity_events for select using (public.is_member());

create or replace function public.track_opportunity_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into ghl_opportunity_events (opp_id, at, kind, to_val) values (new.id, coalesce(new.created_at, now()), 'created', new.stage_name);
    if new.status is distinct from 'open' then
      insert into ghl_opportunity_events (opp_id, at, kind, to_val) values (new.id, coalesce(new.last_status_change_at, new.created_at, now()), 'status', new.status);
    end if;
  else
    if new.stage_id is distinct from old.stage_id then
      insert into ghl_opportunity_events (opp_id, at, kind, from_val, to_val)
      values (new.id, coalesce(new.last_stage_change_at, now()), 'stage', old.stage_name, new.stage_name);
    end if;
    if new.status is distinct from old.status then
      insert into ghl_opportunity_events (opp_id, at, kind, from_val, to_val)
      values (new.id, coalesce(new.last_status_change_at, now()), 'status', old.status, new.status);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.track_opportunity_events() from public, anon, authenticated;
drop trigger if exists ghl_opportunities_events on public.ghl_opportunities;
create trigger ghl_opportunities_events after insert or update on public.ghl_opportunities
  for each row execute function public.track_opportunity_events();

-- Punto de partida del historial: el estado actual de las oportunidades ya sincronizadas
insert into public.ghl_opportunity_events (opp_id, at, kind, to_val)
select id, coalesce(created_at, now()), 'created', stage_name from public.ghl_opportunities o
where not exists (select 1 from public.ghl_opportunity_events e where e.opp_id = o.id);

-- 3) Equipo comercial. closer_option = valor del desplegable "Closer" de la oportunidad.
create table if not exists public.comercial_team (
  name text primary key,
  role text not null check (role in ('owner', 'closer', 'setter', 'finanzas')),
  closer_option text unique,
  ghl_user_id text unique,
  comm_dfy numeric,
  comm_jessik numeric,
  active boolean not null default true
);
alter table public.comercial_team enable row level security;
create policy "solo miembros" on public.comercial_team for select using (public.is_member());
insert into public.comercial_team (name, role, closer_option, ghl_user_id, comm_dfy, comm_jessik, active) values
  ('Luca', 'closer', 'Luca', '8Ik8wFHag273XhAacKpC', 0.03, 0.05, true),
  ('Jenny', 'closer', 'Jenny', 'nemsqu8uDRyZ6lasDDDV', 0.03, 0.05, true),
  ('Eduardo', 'closer', null, 'tCCO6tek3G7rE79H51hN', 0.03, 0.05, false),
  ('Ale', 'owner', 'Ale', null, null, null, true),
  ('Laura', 'setter', null, null, null, null, true)
on conflict (name) do nothing;

-- 4) Ads solo para rol owner (Agustín y Ale). Llamado desde el MCP/cron (sin JWT de usuario) también pasa.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'role', '') not in ('authenticated', 'anon')
      or exists (select 1 from dashboard_members where user_id = auth.uid() and role = 'owner');
$$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

drop policy if exists "solo miembros" on public.meta_ads;
drop policy if exists "solo miembros" on public.meta_insights_daily;
create policy "solo owner" on public.meta_ads for select using (public.is_owner());
create policy "solo owner" on public.meta_insights_daily for select using (public.is_owner());

-- Las funciones de Ads devuelven vacío si no es owner: se renombran a *_core y se envuelven.
alter function public.report(date, date, text) rename to report_core;
alter function public.report_daily(date, date) rename to report_daily_core;
alter function public.cierres(date, date) rename to cierres_core;
alter function public.reporte_fin_de_dia(date, text) rename to reporte_fin_de_dia_core;
revoke execute on function public.report_core(date, date, text), public.report_daily_core(date, date),
  public.cierres_core(date, date), public.reporte_fin_de_dia_core(date, text) from public, anon, authenticated;

create function public.report(p_from date, p_to date, p_level text default 'ad')
returns table(entity_id text, entity_name text, parent_name text, status text, thumbnail_url text, preview_url text, page_id text,
  spend numeric, impressions bigint, clicks bigint, link_clicks bigint, landing_page_views bigint, meta_schedules bigint, agendas bigint,
  calificadas bigint, calificadas_jessik bigint, asistencias bigint, ofertas bigint, cierres bigint, vendido numeric, cobrado numeric)
language sql stable security definer set search_path = public as $$
  select * from report_core(p_from, p_to, p_level) where is_owner();
$$;
create function public.report_daily(p_from date, p_to date)
returns table(d date, spend numeric, agendas bigint, calificadas bigint, asistencias bigint, cierres bigint, cobrado numeric, meta_schedules bigint)
language sql stable security definer set search_path = public as $$
  select * from report_daily_core(p_from, p_to) where is_owner();
$$;
create function public.cierres(p_from date, p_to date)
returns table(fecha date, nombre text, telefono text, email text, closer text, modalidad text, vendido numeric, cobrado numeric,
  campaign_name text, adset_name text, ad_name text, ad_id text, preview_url text, page_id text, cuenta text)
language sql stable security definer set search_path = public as $$
  select * from cierres_core(p_from, p_to) where is_owner();
$$;
create function public.reporte_fin_de_dia(p_day date, p_nota text default null) returns text
language sql volatile security definer set search_path = public as $$
  select case when is_owner() then reporte_fin_de_dia_core(p_day, p_nota) end;
$$;
revoke execute on function public.report(date, date, text), public.report_daily(date, date), public.cierres(date, date),
  public.reporte_fin_de_dia(date, text) from public, anon;
grant execute on function public.report(date, date, text), public.report_daily(date, date), public.cierres(date, date),
  public.reporte_fin_de_dia(date, text) to authenticated;
