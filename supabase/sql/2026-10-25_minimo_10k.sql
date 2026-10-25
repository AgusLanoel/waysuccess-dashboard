-- 25-10: el mínimo sube de $5k a $10k. Opciones nuevas del formulario: "Menos de $10k/Mes USD" y "$10k a $20k/Mes USD".
-- JessiK = $5k–20k (respuestas viejas) o $10k–20k (nuevas). "Menos de …" sigue sin calificar.
create or replace function public.is_jessik(cf jsonb)
 returns boolean language sql immutable set search_path to ''
as $function$
  select coalesce(public.income_answer(cf), '') ~* '^\s*\$?\s*(5|10)k\s*a\s*\$?\s*20k'
$function$;
