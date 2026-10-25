-- Ventas solo desde GHL (2026-10-25, pedido del dueño): la hoja se elimina.
-- Cierres / vendido / cobrado = oportunidades Won del pipeline "2. Leads (Agendado) - Venta" (kW8pBFCaVVZJ1pw9okvh), de cualquier fecha.
-- Fuente y primera llamada de las ventas históricas salen de GHL (atribución por persona y citas del GHL viejo y nuevo), no de la hoja.

create or replace view public.v_com_opps with (security_invoker = true) as
 WITH appt AS (
         SELECT a.contact_id,
            min(a.start_time) FILTER (WHERE (a.status <> ALL (ARRAY['cancelled'::text, 'invalid'::text]))) AS primera_llamada,
            (array_agg(a.assigned_user_id ORDER BY a.start_time DESC))[1] AS ultimo_closer_id,
            bool_or((a.status = 'showed'::text)) AS showed
           FROM ghl_appointments a
          WHERE ((a.calendar_id = '7SNm0NGnthgEIWCbOf05'::text) AND (NOT a.deleted))
          GROUP BY a.contact_id
        ), base AS (
         SELECT o_1.id, o_1.contact_id, o_1.pipeline_id, o_1.stage_id, o_1.stage_name, o_1.status, o_1.monetary_value, o_1.source,
            o_1.created_at, o_1.updated_at, o_1.synced_at, o_1.name, o_1.assigned_to, o_1.cf, o_1.lost_reason_id,
            o_1.last_stage_change_at, o_1.last_status_change_at,
            c.email_norm, c.phone_norm, c.custom_fields AS ccf, c.tags,
            ('historico-importado'::text = ANY (COALESCE(c.tags, '{}'::text[]))) AS es_historico,
            COALESCE((ca.is_paid AND (NOT ca.other_account)), false) AS paid
           FROM ((ghl_opportunities o_1
             LEFT JOIN ghl_contacts c ON ((c.id = o_1.contact_id)))
             LEFT JOIN v_contact_attribution ca ON ((ca.contact_id = o_1.contact_id)))
          WHERE (o_1.pipeline_id = 'kW8pBFCaVVZJ1pw9okvh'::text)
        )
 SELECT o.id,
    o.contact_id,
    COALESCE(o.name, o.email_norm) AS nombre,
    o.email_norm AS email,
    o.phone_norm AS telefono,
    o.stage_name AS etapa,
    o.status,
    COALESCE(o.monetary_value, (0)::numeric) AS valor,
        CASE
            WHEN ((o.cf ->> '50leQ4Rh4kKu08aQOcRQ'::text) ~~* 'DFY%'::text) THEN 'DFY'::text
            WHEN ((o.cf ->> '50leQ4Rh4kKu08aQOcRQ'::text) ~~* 'JessiK%'::text) THEN 'JessiK'::text
            WHEN is_jessik(o.ccf) THEN 'JessiK'::text
            WHEN is_qualified(o.ccf) THEN 'DFY'::text
            ELSE 'Sin definir'::text
        END AS producto,
    COALESCE(tc.name, ta.name, tl.name) AS closer,
    (o.cf ->> 'XD595uUhP5aHlrwXpjPk'::text) AS setter,
    (o.cf ->> 'iBsP8fpGIsG4LOu8uIuv'::text) AS calificacion,
    ((o.cf ->> 'H3JJfIUflRDFxE0vnllM'::text) = 'Si'::text) AS oferta_hecha,
    (COALESCE(((o.cf ->> 'Vp3rYUo47OzLrgxol7yP'::text) = 'Si'::text), false) OR COALESCE(appt.showed, false) OR (o.status = 'won'::text) OR (o.stage_name = ANY (ARRAY['P1 - No tiene interés en este momento'::text, 'P3 - Interés pero no puede ahora'::text, 'P5 - Compra este mes'::text, 'Reserva'::text, 'Cerrado - Contrato'::text, '2da Llamada Agenda'::text]))) AS asistio,
    -- Primera llamada de la persona en cualquier calendario (GHL viejo y nuevo), por contacto, email o teléfono.
    COALESCE((appt.primera_llamada AT TIME ZONE 'America/Argentina/Buenos_Aires'::text)::date,
      (SELECT min((a.start_time AT TIME ZONE 'America/Argentina/Buenos_Aires'::text)::date)
         FROM ghl_appointments a JOIN ghl_contacts c2 ON c2.id = a.contact_id
        WHERE NOT a.deleted AND a.status <> ALL (ARRAY['cancelled'::text, 'invalid'::text])
          AND ((o.email_norm <> '' AND c2.email_norm = o.email_norm) OR (o.phone_norm <> '' AND c2.phone_norm = o.phone_norm)))) AS primera_llamada,
        CASE
            WHEN (o.status = 'won'::text) THEN COALESCE(((o.cf ->> 'UmC8dTOZuUAU5xkYxNLN'::text))::date,
            CASE
                WHEN (NOT o.es_historico) THEN ((o.last_status_change_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date
                ELSE NULL::date
            END)
            ELSE NULL::date
        END AS fecha_cierre,
    ((o.cf ->> 'UmC8dTOZuUAU5xkYxNLN'::text) IS NOT NULL) AS fecha_cierre_cargada,
    COALESCE(((o.cf ->> 'cQtlWKYlLm99Xe2r6mHQ'::text))::numeric, (0)::numeric) AS cobrado,
    COALESCE((o.cf ->> 'Tps3Qa5SUKABPs5Nks3f'::text), (o.cf ->> 'Jd2qCnJz54LxGP5HPlCS'::text), (o.cf ->> 'I1YDC7yUCv8z7eTWJQIl'::text)) AS motivo,
    ((o.cf ->> 'cZQznvJEZOmObwid7Lgs'::text))::date AS proximo_seguimiento,
    (o.cf ->> 'vbhiRxCKHaeUT9TUNzqC'::text) AS plan_pago,
    (o.cf ->> 'rhKzKMydHOcBUCjRrW3y'::text) AS metodo_cobro,
    ((o.cf ->> 'n92CtwQu5OqNYk7hwvbs'::text))::numeric AS saldo_pendiente,
    ((o.cf ->> 'b21wY5kT3kByWdbZpXJZ'::text))::date AS proximo_cobro_fecha,
    ((o.cf ->> 'T7WlzpunagSGPlFSklRz'::text))::numeric AS proximo_cobro_monto,
    (o.cf ->> '2lrp6WvUZk1HcWPVLLCa'::text) AS link_grabacion,
    o.es_historico AS historico,
    o.paid AS de_ads,
    o.created_at,
    o.last_stage_change_at,
    fuente_contacto(o.ccf, o.paid) AS fuente
   FROM ((((base o
     LEFT JOIN appt ON ((appt.contact_id = o.contact_id)))
     LEFT JOIN comercial_team tc ON ((tc.closer_option = (o.cf ->> 'eDFc3YKm41aXOXf7UR8m'::text))))
     LEFT JOIN comercial_team ta ON ((ta.ghl_user_id = o.assigned_to)))
     LEFT JOIN comercial_team tl ON ((tl.ghl_user_id = appt.ultimo_closer_id)));

create or replace function public.refresh_comercial()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  delete from com_opps_snap; insert into com_opps_snap select * from v_com_opps;
  delete from com_calls_snap; insert into com_calls_snap select * from v_com_calls_todas;
  delete from com_agendas_snap; insert into com_agendas_snap select * from v_com_agendas;
  insert into settings (key, value, note) values ('comercial_refresh', to_jsonb(now()), 'Última foto de los datos comerciales (refresh_comercial)')
  on conflict (key) do update set value = excluded.value;
end $function$;

create or replace function public.cierres_core(p_from date, p_to date)
 returns table(fecha date, nombre text, telefono text, email text, closer text, modalidad text, vendido numeric, cobrado numeric, campaign_name text, adset_name text, ad_name text, ad_id text, preview_url text, page_id text, cuenta text)
 language sql stable set search_path to 'public'
as $function$
  -- Cierres de Ads: oportunidades Won del pipeline de Venta en GHL que vinieron de un anuncio. La hoja ya no se usa.
  select o.fecha_cierre, o.nombre, o.telefono, o.email, o.closer, o.plan_pago, o.valor, o.cobrado,
         case when ca.is_paid then coalesce(ma.campaign_name, mc.campaign_name) else 'Ads sin datos del anuncio' end,
         case when ca.is_paid then coalesce(ma.adset_name, ms.adset_name) end,
         case when ca.is_paid then ma.ad_name end,
         case when ca.is_paid then ca.ad_id end,
         case when ca.is_paid then ma.preview_url end,
         coalesce(ma.page_id, ms.page_id),
         case when coalesce(ma.account_id, ms.account_id, mc.account_id) = '1376171866434598' then 'Cerrada'
              when ca.is_paid then 'USA' else 'Sin datos del anuncio' end
  from public.com_opps_snap o
  left join public.v_contact_attribution ca on ca.contact_id = o.contact_id
  left join public.meta_ads ma on ma.ad_id = ca.ad_id and ca.is_paid
  left join lateral (select x.adset_name, x.page_id, x.account_id from public.meta_ads x where ca.is_paid and x.adset_id = ca.adset_id limit 1) ms on true
  left join lateral (select x.campaign_name, x.account_id from public.meta_ads x where ca.is_paid and x.campaign_id = ca.campaign_id limit 1) mc on true
  where o.status = 'won' and (o.de_ads or o.fuente = 'Ads') and o.fecha_cierre between p_from and p_to
  order by 1 desc, o.valor desc
$function$;

-- Eventos del funnel de Ads: cierres/vendido/cobrado solo desde el pipeline (sin corte de fecha).
-- Asistencias/ofertas anteriores al 21-10 siguen saliendo de la copia congelada (sheet_calls) hasta que el dueño decida.
create or replace view public.v_funnel_events with (security_invoker = true) as
 SELECT a.contact_id, ((a.date_added AT TIME ZONE 'America/New_York'::text))::date AS d, 'agenda'::text AS kind, (1)::numeric AS amount
   FROM ghl_appointments a WHERE (NOT a.deleted)
UNION ALL
 SELECT a.contact_id, ((a.date_added AT TIME ZONE 'America/New_York'::text))::date, 'calificada'::text, 1
   FROM ghl_appointments a JOIN ghl_contacts c ON c.id = a.contact_id
  WHERE NOT a.deleted AND is_qualified(c.custom_fields)
UNION ALL
 SELECT a.contact_id, ((a.date_added AT TIME ZONE 'America/New_York'::text))::date, 'calificada_jessik'::text, 1
   FROM ghl_appointments a JOIN ghl_contacts c ON c.id = a.contact_id
  WHERE NOT a.deleted AND is_jessik(c.custom_fields)
UNION ALL
 SELECT s.contact_id, s.call_date, 'asistencia'::text, 1 FROM sheet_calls s
  WHERE s.estado_llamada ~~* 'asisti%'::text AND s.call_date < comercial_corte()
UNION ALL
 SELECT s.contact_id, s.call_date, 'oferta'::text, 1 FROM sheet_calls s
  WHERE s.oferta_hecha AND s.call_date < comercial_corte()
UNION ALL
 SELECT k.contact_id, k.fecha_llamada, 'asistencia'::text, 1 FROM com_calls_snap k WHERE k.en_vivo AND k.asistio
UNION ALL
 SELECT k.contact_id, k.fecha_llamada, 'oferta'::text, 1 FROM com_calls_snap k WHERE k.en_vivo AND k.oferta_hecha
UNION ALL
 SELECT o.contact_id, o.fecha_cierre, 'cierre'::text, 1 FROM com_opps_snap o WHERE o.status = 'won'
UNION ALL
 SELECT o.contact_id, o.fecha_cierre, 'vendido'::text, o.valor FROM com_opps_snap o WHERE o.status = 'won' AND o.valor > 0
UNION ALL
 SELECT o.contact_id, o.fecha_cierre, 'cobrado'::text, o.cobrado FROM com_opps_snap o WHERE o.status = 'won' AND o.cobrado > 0;
