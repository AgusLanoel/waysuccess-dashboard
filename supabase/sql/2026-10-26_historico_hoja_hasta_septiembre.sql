-- Dueño 26-10: el histórico hasta el 30-09 tiene que ser copia exacta del sheet "Comercial Backup" (pestaña Llamadas,
-- 1 fila = 1 llamada agendada). Control: Dashboard del sheet hasta 30-09, todos los productos = 256 agendas,
-- 164 asistencias, 161 calificadas, 137 ofertas (Ads 63 · Orgánico 152 · Referidos 19 · Afiliados 6 · sin fuente 16).
-- Desde 01-10: GHL (calendarios viejos hasta el corte 21-10, StartFly después), solo calificadas no canceladas.
-- agenda_key: el sheet cuenta filas (una persona puede tener 2 agendas); GHL cuenta contactos distintos.
create or replace function public.historico_hasta() returns date language sql immutable as $$ select date '2026-09-30' $$;

alter table sheet_calls add column if not exists producto text; -- columna "Producto" del sheet (30k / Jessik)

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
    t.name AS closer,
    a.contact_id AS agenda_key
   FROM (((ghl_appointments a
     LEFT JOIN ghl_contacts c ON ((c.id = a.contact_id)))
     LEFT JOIN v_contact_attribution ca ON ((ca.contact_id = a.contact_id)))
     LEFT JOIN comercial_team t ON ((t.ghl_user_id = a.assigned_user_id)))
  WHERE ((NOT a.deleted) AND (((a.calendar_id = '7SNm0NGnthgEIWCbOf05'::text) AND (a.date_added >= comercial_corte())) OR ((a.calendar_id = ANY (ARRAY['aLqJG1EY9LmXyuWh6lJE'::text, 'l6nDyuqheYOmLWu813Ez'::text])) AND (a.date_added < comercial_corte())))
    AND (is_jessik(c.custom_fields) OR is_qualified(c.custom_fields))
    AND a.status <> ALL (ARRAY['cancelled'::text, 'invalid'::text])
    AND ((a.date_added AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date > historico_hasta())
UNION ALL
 SELECT s.contact_id,
    s.call_date AS fecha_agenda,
        CASE
            WHEN s.producto = '30k'::text THEN 'DFY'::text
            WHEN s.producto ILIKE 'jessik'::text THEN 'JessiK'::text
            ELSE 'Sin definir'::text
        END AS producto,
    false AS en_vivo,
    fuente_hoja(s.origen) AS fuente,
    closer_norm(s.closer) AS closer,
    'hoja-'::text || s.row_num AS agenda_key
   FROM sheet_calls s
  WHERE s.call_date <= historico_hasta();

alter table com_agendas_snap add column if not exists agenda_key text;

-- Agendas: count(distinct a.agenda_key) en comercial() y comercial_empresa() (antes contact_id). Aplicado con replace()
-- sobre pg_get_functiondef. Llamadas del sheet: producto sale de la columna Producto del sheet (antes del contacto GHL):
-- v_com_calls_archivo CASE agrega  WHEN s.producto = '30k' THEN 'DFY'  WHEN s.producto ~~* 'jessik' THEN 'JessiK'  al principio.
-- Verificado 26-10 hasta 30-09: agendas 256 (DFY 239), asistencias 164, calificadas 161, ofertas 137 = sheet.
select refresh_comercial();

-- 26-10 (rediseño Comercial): comercial() calidad devuelve también o.producto (filtro por oferta en "Detalle por oferta").
-- Aplicado con replace('select o.id, o.nombre, o.closer, o.etapa, o.historico, x.problema' → '..., o.historico, o.producto, x.problema').
