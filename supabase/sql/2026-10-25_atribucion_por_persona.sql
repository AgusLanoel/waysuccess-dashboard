-- Atribución por persona (2026-10-25).
-- Con la migración a GHL StartFly (21-10) cada cliente quedó con dos contactos: el viejo, con UTMs/anuncio,
-- y el nuevo importado por CSV, sin datos de origen. Las ventas cuelgan del nuevo, así que no tenían anuncio.
-- Un contacto sin ningún dato de origen hereda la atribución del contacto más reciente del mismo email o teléfono que sí la tenga.
create or replace view public.v_contact_attribution with (security_invoker = true) as
 WITH raw AS (
         SELECT c_1.*,
            (COALESCE(c_1.first_ad_id, c_1.last_ad_id, c_1.first_adset_id, c_1.last_adset_id, c_1.first_campaign_id, c_1.last_campaign_id,
                      c_1.first_url, c_1.last_url, c_1.first_utm_content, c_1.last_utm_content) IS NOT NULL) AS has_attr
           FROM ghl_contacts c_1
        ), src AS (
         SELECT r.id AS contact_id,
            COALESCE(CASE WHEN r.has_attr THEN r.id END,
              (SELECT s.id FROM raw s
                WHERE s.has_attr AND s.id <> r.id
                  AND ((r.email_norm <> '' AND s.email_norm = r.email_norm) OR (r.phone_norm <> '' AND s.phone_norm = r.phone_norm))
                ORDER BY s.date_added DESC LIMIT 1),
              r.id) AS src_id
           FROM raw r
        ), base AS (
         SELECT x.contact_id AS id,
            c_1.custom_fields,
            c_1.first_url,
            c_1.last_url,
            c_1.first_ad_id,
            c_1.first_adset_id,
            c_1.first_campaign_id,
            c_1.first_utm_content,
            c_1.first_utm_campaign,
            c_1.last_ad_id,
            c_1.last_adset_id,
            c_1.last_campaign_id,
            c_1.last_utm_content,
            c_1.last_utm_campaign,
            COALESCE(c_1.last_adset_id, c_1.first_adset_id) AS aset,
            COALESCE(c_1.last_ad_id, c_1.first_ad_id, match_ad(COALESCE(c_1.last_adset_id, c_1.first_adset_id), COALESCE(c_1.last_utm_content, c_1.first_utm_content, (c_1.custom_fields ->> 'j42OHsWSKDVvMWkv48Le'::text), (c_1.custom_fields ->> 'OVAkHPPCuyxnRql6wKr1'::text)), c_1.date_added)) AS resolved_ad,
            lower("substring"(COALESCE(c_1.last_url, c_1.first_url), 'utm_medium=([^&#]*)'::text)) AS medium
           FROM src x
             JOIN raw c_1 ON c_1.id = x.src_id
        )
 SELECT c.id AS contact_id,
    c.resolved_ad AS ad_id,
    COALESCE(ma.adset_id, c.aset) AS adset_id,
    COALESCE(ma.campaign_id, c.last_campaign_id, c.first_campaign_id) AS campaign_id,
    COALESCE(c.last_utm_content, c.first_utm_content) AS utm_content,
    COALESCE(c.last_utm_campaign, c.first_utm_campaign) AS utm_campaign,
    ((COALESCE(c.last_ad_id, c.first_ad_id, c.last_adset_id, c.first_adset_id, c.last_campaign_id, c.first_campaign_id) IS NOT NULL) OR ((COALESCE(c.last_url, c.first_url) ~* 'utm_source=(fb|facebook|meta|ig|instagram)'::text) AND (COALESCE(c.medium, ''::text) !~ '^(social|bio|organic|organico|reels)'::text))) AS is_paid,
    ((COALESCE(c.last_ad_id, c.first_ad_id, c.last_adset_id, c.first_adset_id, c.last_campaign_id, c.first_campaign_id) IS NOT NULL) AND (ma.ad_id IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM meta_ads x
          WHERE ((x.adset_id = c.aset) OR (x.campaign_id = COALESCE(c.last_campaign_id, c.first_campaign_id))))))) AS other_account
   FROM base c
     LEFT JOIN meta_ads ma ON ma.ad_id = c.resolved_ad;

-- match_ad con fecha: sin conjunto en la URL y varios anuncios con el mismo nombre → el que gastó en los 3 días previos a la agenda.
create or replace function public.match_ad(p_adset text, p_code text, p_at timestamptz)
 returns text language sql stable security definer set search_path to ''
as $function$
  with m as (select public.match_ad(p_adset, p_code) ad_id),
  k as (select public.ad_code(p_code) c),
  cand as (
    select a.ad_id, coalesce(sum(i.spend), 0) sp
    from public.meta_ads a cross join k
    left join public.meta_insights_daily i on i.ad_id = a.ad_id
      and i.date between (p_at at time zone 'America/Los_Angeles')::date - 3 and (p_at at time zone 'America/Los_Angeles')::date
    where p_adset is null and p_at is not null and k.c is not null and public.ad_code(a.ad_name) = k.c
    group by a.ad_id
  ),
  top as (select ad_id, sp, sp / nullif(sum(sp) over (), 0) share from cand order by sp desc limit 1)
  select coalesce((select ad_id from m),
                  (select ad_id from top where sp > 0 and share >= 0.8));
$function$;

-- Miguel Gaitán entró por el link de la bio de IG: orgánico (confirmado por el dueño 25-10).
update public.sheet_calls set origen = 'Orgánico' where row_num = 167 and email_norm = 'gaitanmiguel91@gmail.com';
