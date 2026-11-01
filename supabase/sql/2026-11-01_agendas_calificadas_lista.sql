-- 01-11-2026: lista de agendas calificadas (reemplaza los gráficos "Inversión/Agendas por día" en Ads).
-- Misma regla que v_funnel_events: PRIMERA agenda calificada por persona (is_10k_plus), solo pago
-- (is_paid y no otra cuenta), día en hora del Pacífico.
alter table public.ghl_contacts
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists timezone text;

create or replace function public.agendas_calificadas(p_from date, p_to date)
returns table(
  contact_id text, agendada_at timestamptz, llamada_at timestamptz, estado text, tipo text,
  nombre text, email text, phone text, nicho text, ingresos text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, timezone text
)
language sql stable security definer set search_path to ''
as $$
  with calif as (
    select a.contact_id, a.date_added, a.start_time, a.status, c.custom_fields cf,
           row_number() over (partition by a.contact_id order by a.date_added) n
    from public.ghl_appointments a join public.ghl_contacts c on c.id = a.contact_id
    where not a.deleted and public.is_10k_plus(c.custom_fields)
  )
  select q.contact_id, q.date_added, q.start_time, q.status,
         case when public.is_jessik(q.cf) then 'JessiK' else 'DFY' end,
         nullif(c.full_name, ''),
         coalesce(nullif(c.email, ''), c.email_norm),
         coalesce(nullif(c.phone, ''), c.phone_norm),
         q.cf->>'Zx82M03hxVfg98NtIvGD',
         public.income_answer(q.cf),
         coalesce(q.cf->>'TUupa8XeUMM7aVqdHq5Q', q.cf->>'FX69'),
         q.cf->>'iAlLHCOaqMARdN2Qae9R',
         coalesce(q.cf->>'q2QBhRbgfq64l9PfLCEZ', ca.utm_campaign),
         coalesce(q.cf->>'OVAkHPPCuyxnRql6wKr1', ca.utm_content),
         nullif(c.timezone, '')
  from calif q
  join public.ghl_contacts c on c.id = q.contact_id
  join public.v_contact_attribution ca on ca.contact_id = q.contact_id and ca.is_paid and not ca.other_account
  where q.n = 1
    and (q.date_added at time zone 'America/Los_Angeles')::date between p_from and p_to
    and public.is_owner()
  order by q.date_added desc;
$$;

revoke all on function public.agendas_calificadas(date, date) from public, anon;
grant execute on function public.agendas_calificadas(date, date) to authenticated;
