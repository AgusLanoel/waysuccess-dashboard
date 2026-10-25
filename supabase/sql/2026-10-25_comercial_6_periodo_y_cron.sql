-- Período de comparación: si arranca el día 1, contra los mismos días del mes anterior (1–25 oct vs 1–25 sep);
-- si no, el período anterior del mismo largo. Aplicado reemplazando el texto dentro de comercial() y comercial_empresa().
-- prev/anterior = case when extract(day from p_from) = 1 then (p_from - interval '1 month')::date else p_from - (p_to - p_from + 1) end
--               a case when extract(day from p_from) = 1 then (p_to - interval '1 month')::date else p_from - 1 end
-- Foto comercial refrescada cada 5 minutos:
select cron.schedule('refresh-comercial', '*/5 * * * *', 'select public.refresh_comercial()');
-- Permisos por fila evaluados una vez por consulta: using ((select is_member())) / ((select is_owner())).
