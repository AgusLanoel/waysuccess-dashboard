-- 27-11: DMs y respuestas a historias con palabra clave → mismo flujo que los comentarios (edge fn ig-dm-palabras).
-- APLICADO (migración ig_dm_palabras_cursor):
create table if not exists public.org_ig_cursor (
  clave text primary key,
  valor timestamptz not null,
  actualizado_at timestamptz not null default now()
);
create table if not exists public.org_dm_vistos (
  mid text primary key,          -- id del mensaje en Graph (= mid del webhook): cada mensaje se procesa una sola vez
  ig_sender text,
  creado_at timestamptz,
  resultado text,                -- sin palabra / largo (no dispara) / apertura enviada / ya recibió link en 24 h / ...
  visto_at timestamptz not null default now()
);
alter table public.org_ig_cursor enable row level security;
alter table public.org_dm_vistos enable row level security;
insert into public.org_ig_cursor (clave, valor) values ('ws_dm', '2026-11-27 16:00:00-03') on conflict (clave) do nothing;

-- PENDIENTE (activar con OK del dueño): el cron que manda las aperturas a quien escriba la palabra.
-- Opcional: arrancar desde ahora para no contestar mensajes viejos (si no, contesta los de las últimas 24 h desde el cursor).
-- update public.org_ig_cursor set valor = now(), actualizado_at = now() where clave = 'ws_dm';
-- select cron.schedule('ig-dm-palabras', '* * * * *', $$select private.call_fn('ig-dm-palabras','{}'::jsonb)$$);
-- Apagar: select cron.unschedule('ig-dm-palabras');
-- Prueba sin enviar nada: select private.call_fn('ig-dm-palabras', '{"dry": true, "desde": "2026-11-22"}'::jsonb);
