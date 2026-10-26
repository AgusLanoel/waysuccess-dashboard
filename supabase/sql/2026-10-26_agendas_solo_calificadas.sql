-- Dueño 26-10: "agendas" = solo calificadas (DFY o JessiK) y no canceladas.
-- Antes contaba todas (incluidas no calificadas y canceladas) y inflaba agendas e hundía show rate / % de cada paso.
-- Histórico Marketing (Ads + Orgánico) esperado: 239.
create or replace view public.v_com_agendas as
 SELECT a.contact_id,
    ((a.date_added AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date AS fecha_agenda,
        CASE
            WHEN is_jessik(c.custom_fields) THEN 'JessiK'::text
            WHEN is_qualified(c.custom_fields) THEN 'DFY'::text
            ELSE 'Sin definir'::text
        END AS producto,
    (a.calendar_id = '7SNm0NGnthgEIWCbOf05'::text) AS en_vivo,
    fuente_contacto(c.custom_fields, (ca.is_paid AND (NOT ca.other_account))) AS fuente,
    t.name AS closer
   FROM (((ghl_appointments a
     LEFT JOIN ghl_contacts c ON ((c.id = a.contact_id)))
     LEFT JOIN v_contact_attribution ca ON ((ca.contact_id = a.contact_id)))
     LEFT JOIN comercial_team t ON ((t.ghl_user_id = a.assigned_user_id)))
  WHERE ((NOT a.deleted) AND (((a.calendar_id = '7SNm0NGnthgEIWCbOf05'::text) AND (a.date_added >= comercial_corte())) OR ((a.calendar_id = ANY (ARRAY['aLqJG1EY9LmXyuWh6lJE'::text, 'l6nDyuqheYOmLWu813Ez'::text])) AND (a.date_added < comercial_corte())))
    AND (is_jessik(c.custom_fields) OR is_qualified(c.custom_fields))
    AND a.status <> ALL (ARRAY['cancelled'::text, 'invalid'::text]));

select refresh_comercial();
