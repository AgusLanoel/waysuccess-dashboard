-- 27-11 Automatizaciones de IG: métricas tipo ManyChat + A/B testing + saludo con nombre.
-- SOLO ADITIVA: columnas nuevas con default nulo/false, tablas nuevas, funciones nuevas. Nada existente cambia.
-- Sin test corriendo, org_auto_asignar() no devuelve filas y las funciones se comportan como v13.

-- ───────── columnas nuevas ─────────
alter table public.org_mensajes
  add column if not exists variante_id bigint,
  add column if not exists test_id bigint,
  add column if not exists respondio_at timestamptz,      -- cuándo tocó/respondió la apertura (lo pone ig-respuestas)
  add column if not exists saludo text,                   -- nombre_api | nombre_usuario | sin_nombre | arroba (apertura)
  add column if not exists saludo2 text,                  -- saludo del paso 2 (link)
  add column if not exists recordatorio_at timestamptz,   -- recordatorio único (apagado por defecto)
  add column if not exists recordatorio_error text;
alter table public.org_links
  add column if not exists variante_id bigint,
  add column if not exists variante text;
alter table public.org_automatizaciones
  add column if not exists recordatorio_activo boolean not null default false,
  add column if not exists recordatorio_horas integer not null default 4,
  add column if not exists recordatorio_texto text;

create index if not exists org_mensajes_variante_idx on public.org_mensajes (variante_id) where variante_id is not null;
create index if not exists org_mensajes_slug_idx on public.org_mensajes (slug);
create index if not exists ghl_contacts_slug_org_idx on public.ghl_contacts ((custom_fields ->> 'UBBOVwiLanwMp4odGPmT')) where custom_fields ? 'UBBOVwiLanwMp4odGPmT';
create index if not exists quiz_eventos_term_idx on public.quiz_eventos ((utms ->> 'utm_term'));
create index if not exists org_clics_slug_idx on public.org_clics (slug);

-- ───────── A/B ─────────
create table if not exists public.org_auto_tests (
  id bigserial primary key,
  automatizacion_id bigint not null references public.org_automatizaciones(id),
  nombre text not null,
  metrica text not null default 'clic' check (metrica in ('toque', 'clic', 'agenda')),
  estado text not null default 'borrador' check (estado in ('borrador', 'corriendo', 'pausado', 'cerrado')),
  iniciado_at timestamptz,
  cerrado_at timestamptz,
  ganadora_id bigint,
  notas text,
  creado_at timestamptz not null default now()
);
-- un solo test abierto (no cerrado) por automatización
create unique index if not exists org_auto_tests_uno_abierto on public.org_auto_tests (automatizacion_id) where estado <> 'cerrado';

create table if not exists public.org_auto_variantes (
  id bigserial primary key,
  test_id bigint not null references public.org_auto_tests(id),
  letra text not null,
  nombre text,
  mensaje_apertura text,
  boton_apertura text check (boton_apertura is null or char_length(boton_apertura) <= 20),
  mensaje text,
  boton_link text check (boton_link is null or char_length(boton_link) <= 20),
  destino text,
  peso integer not null default 50 check (peso between 0 and 100),
  creado_at timestamptz not null default now(),
  unique (test_id, letra)
);

create table if not exists public.org_auto_asignaciones (
  test_id bigint not null references public.org_auto_tests(id),
  usuario text not null,
  variante_id bigint not null references public.org_auto_variantes(id),
  asignado_at timestamptz not null default now(),
  primary key (test_id, usuario)
);

alter table public.org_auto_tests enable row level security;
alter table public.org_auto_variantes enable row level security;
alter table public.org_auto_asignaciones enable row level security;
-- sin políticas: solo se accede por las RPC security definer de abajo

-- ───────── nombres de pila (saludo cuando el perfil no trae name) ─────────
create table if not exists public.org_nombres_pila (clave text primary key, nombre text not null);
alter table public.org_nombres_pila enable row level security;
insert into public.org_nombres_pila (clave, nombre) values ('aaron','Aarón'),('abel','Abel'),('abigail','Abigail'),('abraham','Abraham'),('ada','Ada'),('adan','Adán'),('adela','Adela'),('adelina','Adelina'),('adolfo','Adolfo'),('adriana','Adriana'),('adrian','Adrián'),('agustin','Agustín'),('agustina','Agustina'),('aida','Aida'),('aitana','Aitana'),('alan','Alan'),('alba','Alba'),('alberto','Alberto'),('albert','Albert'),('alejandra','Alejandra'),('alejandro','Alejandro'),('alex','Alex'),('alexa','Alexa'),('alexander','Alexander'),('alexandra','Alexandra'),('alexis','Alexis'),('alfonso','Alfonso'),('alfredo','Alfredo'),('alicia','Alicia'),('alison','Alison'),('alma','Alma'),('alvaro','Álvaro'),('amalia','Amalia'),('amanda','Amanda'),('amelia','Amelia'),('amparo','Amparo'),('ana','Ana'),('anabel','Anabel'),('anahi','Anahí'),('analia','Analía'),('andrea','Andrea'),('andres','Andrés'),('andy','Andy'),('angel','Ángel'),('angela','Ángela'),('angeles','Ángeles'),('angelica','Angélica'),('angie','Angie'),('anibal','Aníbal'),('anita','Anita'),('antonella','Antonella'),('antonia','Antonia'),('antonio','Antonio'),('ariadna','Ariadna'),('ariana','Ariana'),('ariel','Ariel'),('armando','Armando'),('arturo','Arturo'),('astrid','Astrid'),('aurora','Aurora'),('axel','Axel'),('barbara','Bárbara'),('beatriz','Beatriz'),('belen','Belén'),('benjamin','Benjamín'),('berenice','Berenice'),('bernardo','Bernardo'),('bianca','Bianca'),('blanca','Blanca'),('brandon','Brandon'),('brenda','Brenda'),('briana','Briana'),('bruno','Bruno'),('camila','Camila'),('camilo','Camilo'),('carina','Carina'),('carla','Carla'),('carlos','Carlos'),('carmen','Carmen'),('carolina','Carolina'),('catalina','Catalina'),('cecilia','Cecilia'),('celeste','Celeste'),('celia','Celia'),('cesar','César'),('christian','Christian'),('cinthia','Cinthia'),('clara','Clara'),('claudia','Claudia'),('claudio','Claudio'),('concepcion','Concepción'),('constanza','Constanza'),('cristian','Cristian'),('cristina','Cristina'),('cristobal','Cristóbal'),('cynthia','Cynthia'),('dafne','Dafne'),('daiana','Daiana'),('daisy','Daisy'),('damian','Damián'),('dana','Dana'),('daniel','Daniel'),('daniela','Daniela'),('danna','Danna'),('dante','Dante'),('dario','Darío'),('david','David'),('debora','Débora'),('delia','Delia'),('diana','Diana'),('diego','Diego'),('dolores','Dolores'),('domingo','Domingo'),('dulce','Dulce'),('edgar','Edgar'),('edith','Edith'),('eduardo','Eduardo'),('elena','Elena'),('eliana','Eliana'),('elias','Elías'),('elisa','Elisa'),('elizabeth','Elizabeth'),('ella','Ella'),('elsa','Elsa'),('emanuel','Emanuel'),('emilia','Emilia'),('emiliano','Emiliano'),('emilio','Emilio'),('emily','Emily'),('emma','Emma'),('enrique','Enrique'),('erick','Erick'),('erika','Erika'),('ernesto','Ernesto'),('esteban','Esteban'),('estefania','Estefanía'),('estela','Estela'),('esther','Esther'),('eugenia','Eugenia'),('eva','Eva'),('evelyn','Evelyn'),('ezequiel','Ezequiel'),('fabian','Fabián'),('fabiola','Fabiola'),('facundo','Facundo'),('fatima','Fátima'),('federico','Federico'),('felipe','Felipe'),('fernanda','Fernanda'),('fernando','Fernando'),('fidel','Fidel'),('flavia','Flavia'),('florencia','Florencia'),('francisca','Francisca'),('francisco','Francisco'),('franco','Franco'),('gabriel','Gabriel'),('gabriela','Gabriela'),('gael','Gael'),('gaston','Gastón'),('genaro','Genaro'),('georgina','Georgina'),('gerardo','Gerardo'),('german','Germán'),('gilberto','Gilberto'),('gisela','Gisela'),('giselle','Giselle'),('gloria','Gloria'),('gonzalo','Gonzalo'),('graciela','Graciela'),('gregorio','Gregorio'),('guadalupe','Guadalupe'),('guillermo','Guillermo'),('gustavo','Gustavo'),('hector','Héctor'),('helena','Helena'),('hernan','Hernán'),('hilda','Hilda'),('hugo','Hugo'),('ignacio','Ignacio'),('ines','Inés'),('ingrid','Ingrid'),('irene','Irene'),('iris','Iris'),('isaac','Isaac'),('isabel','Isabel'),('isabella','Isabella'),('isaias','Isaías'),('ismael','Ismael'),('itzel','Itzel'),('ivan','Iván'),('ivana','Ivana'),('ivonne','Ivonne'),('jacinto','Jacinto'),('jacqueline','Jacqueline'),('jaime','Jaime'),('javier','Javier'),('jazmin','Jazmín'),('jennifer','Jennifer'),('jessica','Jéssica'),('jesus','Jesús'),('jimena','Jimena'),('joaquin','Joaquín'),('joel','Joel'),('johanna','Johanna'),('jonathan','Jonathan'),('jordi','Jordi'),('jorge','Jorge'),('jose','José'),('josefina','Josefina'),('josue','Josué'),('juan','Juan'),('juana','Juana'),('julia','Julia'),('julian','Julián'),('juliana','Juliana'),('julio','Julio'),('karen','Karen'),('karina','Karina'),('karla','Karla'),('katherine','Katherine'),('laura','Laura'),('leandro','Leandro'),('leila','Leila'),('leonardo','Leonardo'),('leonel','Leonel'),('leticia','Leticia'),('lidia','Lidia'),('liliana','Liliana'),('lina','Lina'),('lisandro','Lisandro'),('lizbeth','Lizbeth'),('lorena','Lorena'),('lorenzo','Lorenzo'),('lourdes','Lourdes'),('lucas','Lucas'),('lucia','Lucía'),('luciana','Luciana'),('luciano','Luciano'),('lucrecia','Lucrecia'),('luis','Luis'),('luisa','Luisa'),('lupita','Lupita'),('macarena','Macarena'),('magdalena','Magdalena'),('maite','Maite'),('manuel','Manuel'),('manuela','Manuela'),('marcela','Marcela'),('marcelo','Marcelo'),('marcos','Marcos'),('margarita','Margarita'),('maria','María'),('mariana','Mariana'),('marianela','Marianela'),('maribel','Maribel'),('marina','Marina'),('mario','Mario'),('marisol','Marisol'),('marta','Marta'),('martha','Martha'),('martin','Martín'),('martina','Martina'),('matias','Matías'),('mauricio','Mauricio'),('maximiliano','Maximiliano'),('mayra','Mayra'),('melany','Melany'),('melina','Melina'),('melisa','Melisa'),('mercedes','Mercedes'),('micaela','Micaela'),('miguel','Miguel'),('milagros','Milagros'),('mireya','Mireya'),('miriam','Miriam'),('monica','Mónica'),('natalia','Natalia'),('natividad','Natividad'),('nayeli','Nayeli'),('nelson','Nelson'),('nerea','Nerea'),('nicolas','Nicolás'),('nicole','Nicole'),('noelia','Noelia'),('noemi','Noemí'),('norma','Norma'),('octavio','Octavio'),('olga','Olga'),('oliver','Oliver'),('olivia','Olivia'),('omar','Omar'),('oscar','Óscar'),('pablo','Pablo'),('paloma','Paloma'),('pamela','Pamela'),('paola','Paola'),('patricia','Patricia'),('patricio','Patricio'),('paula','Paula'),('paulina','Paulina'),('pedro','Pedro'),('pilar','Pilar'),('rafael','Rafael'),('ramiro','Ramiro'),('ramon','Ramón'),('raquel','Raquel'),('raul','Raúl'),('rebeca','Rebeca'),('regina','Regina'),('renata','Renata'),('rene','René'),('ricardo','Ricardo'),('roberto','Roberto'),('rocio','Rocío'),('rodolfo','Rodolfo'),('rodrigo','Rodrigo'),('rogelio','Rogelio'),('rolando','Rolando'),('romina','Romina'),('rosa','Rosa'),('rosario','Rosario'),('ruben','Rubén'),('ruth','Ruth'),('salvador','Salvador'),('samanta','Samanta'),('samuel','Samuel'),('sandra','Sandra'),('santiago','Santiago'),('sara','Sara'),('saul','Saúl'),('sebastian','Sebastián'),('selena','Selena'),('sergio','Sergio'),('silvia','Silvia'),('simon','Simón'),('sofia','Sofía'),('sonia','Sonia'),('susana','Susana'),('tamara','Tamara'),('teresa','Teresa'),('tomas','Tomás'),('valentin','Valentín'),('valentina','Valentina'),('valeria','Valeria'),('vanesa','Vanesa'),('vanessa','Vanessa'),('veronica','Verónica'),('vicente','Vicente'),('victor','Víctor'),('victoria','Victoria'),('violeta','Violeta'),('viviana','Viviana'),('walter','Walter'),('ximena','Ximena'),('yamila','Yamila'),('yesenia','Yesenia'),('yolanda','Yolanda'),('yuliana','Yuliana'),('zoe','Zoe'),('adis','Adis'),('agus','Agus'),('alejo','Alejo'),('andi','Andi'),('beto','Beto'),('cami','Cami'),('dani','Dani'),('gabi','Gabi'),('jessi','Jessi'),('juli','Juli'),('lucho','Lucho'),('majo','Majo'),('mati','Mati'),('pancho','Pancho'),('pepe','Pepe'),('santi','Santi'),('sofi','Sofi'),('vicky','Vicky'),('mary','Mary'),('anne','Anne'),('anna','Anna'),('ashley','Ashley'),('brian','Brian'),('charles','Charles'),('chris','Chris'),('edward','Edward'),('eric','Eric'),('frank','Frank'),('george','George'),('henry','Henry'),('jack','Jack'),('james','James'),('jason','Jason'),('john','John'),('joseph','Joseph'),('josh','Josh'),('kevin','Kevin'),('kimberly','Kimberly'),('linda','Linda'),('lisa','Lisa'),('matthew','Matthew'),('michael','Michael'),('michelle','Michelle'),('nancy','Nancy'),('paul','Paul'),('peter','Peter'),('richard','Richard'),('robert','Robert'),('ryan','Ryan'),('sarah','Sarah'),('steven','Steven'),('thomas','Thomas'),('william','William'),('yuri','Yuri'),('yair','Yair'),('yeison','Yeison'),('wilson','Wilson'),('wendy','Wendy'),('kelly','Kelly'),('leo','Leo'),('max','Max'),('ian','Ian'),('noa','Noa'),('lia','Lía'),('mia','Mía'),('iker','Iker'),('thiago','Thiago'),('tiago','Tiago'),('bautista','Bautista'),('benicio','Benicio'),('lautaro','Lautaro'),('ulises','Ulises'),('esperanza','Esperanza'),('nadia','Nadia'),('nina','Nina'),('rita','Rita'),('ruby','Ruby'),('yasmin','Yasmin'),('yanina','Yanina'),('zulema','Zulema'),('alondra','Alondra'),('nubia','Nubia'),('edwin','Edwin'),('darwin','Darwin'),('jhon','Jhon'),('jhonny','Jhonny'),('stefany','Stefany'),('stephanie','Stephanie'),('yessica','Yessica'),('yenny','Yenny'),('jenny','Jenny'),('johana','Johana'),('luisana','Luisana'),('mariela','Mariela'),('mariangel','Mariangel'),('marlene','Marlene'),('nelly','Nelly'),('yadira','Yadira'),('zuleima','Zuleima'),('gisel','Gisel'),('abril','Abril'),('allison','Allison'),('brayan','Brayan'),('dayana','Dayana'),('deisy','Deisy'),('leidy','Leidy'),('yuli','Yuli'),('jaqueline','Jaqueline') on conflict (clave) do nothing;

-- Nombre de pila para el saludo. 1) name del perfil (igual que antes: primer token con letras);
-- 2) si no hay name: token del usuario que sea un nombre de la lista (exacto 3–12 letras, o nombre ≥4 letras + ≤3 letras
--    de cola: "samuelpr" → Samuel); 3) si no: vacío ("¡Hola!"). Nunca @usuario.
create or replace function public.org_nombre_pila(p_name text, p_username text)
returns table (nombre text, tipo text) language plpgsql stable security definer set search_path to 'public' as $$
declare tok text; toks text[]; i int; r text;
begin
  tok := split_part(btrim(coalesce(p_name, '')), ' ', 1);
  if tok ~ '[[:alpha:]]' then
    return query select upper(left(tok, 1)) || lower(substr(tok, 2)), 'nombre_api'::text; return;
  end if;
  toks := regexp_split_to_array(lower(coalesce(p_username, '')), '[^a-z]+');
  for i in 1 .. least(coalesce(array_length(toks, 1), 0), 4) loop
    tok := toks[i];
    continue when length(tok) < 3 or length(tok) > 15;
    r := null;
    select n.nombre into r from org_nombres_pila n where n.clave = tok and length(tok) <= 12;
    if r is null then
      select n.nombre into r from org_nombres_pila n
       where length(n.clave) >= 4 and tok like n.clave || '%' and length(tok) - length(n.clave) <= 3
       order by length(n.clave) desc limit 1;
    end if;
    if r is not null then return query select r, 'nombre_usuario'::text; return; end if;
  end loop;
  return query select ''::text, 'sin_nombre'::text;
end $$;

-- Variante para una persona (fija: se guarda la primera asignación). Sin test corriendo → no devuelve nada.
create or replace function public.org_auto_asignar(p_auto bigint, p_usuario text)
returns table (test_id bigint, variante_id bigint, letra text, mensaje_apertura text, boton_apertura text, mensaje text, boton_link text, destino text)
language plpgsql security definer set search_path to 'public' as $$
declare t public.org_auto_tests; v public.org_auto_variantes; tot int; r int; acc int := 0;
begin
  if p_usuario is null or p_usuario = '' then return; end if;
  select * into t from org_auto_tests x where x.automatizacion_id = p_auto and x.estado = 'corriendo' limit 1;
  if not found then return; end if;
  select va.* into v from org_auto_asignaciones s join org_auto_variantes va on va.id = s.variante_id where s.test_id = t.id and s.usuario = p_usuario;
  if not found then
    select sum(x.peso) into tot from org_auto_variantes x where x.test_id = t.id and x.peso > 0;
    if coalesce(tot, 0) = 0 then return; end if;
    r := floor(random() * tot)::int;
    for v in select * from org_auto_variantes x where x.test_id = t.id and x.peso > 0 order by x.letra loop
      acc := acc + v.peso;
      exit when r < acc;
    end loop;
    insert into org_auto_asignaciones (test_id, usuario, variante_id) values (t.id, p_usuario, v.id) on conflict do nothing;
    select va.* into v from org_auto_asignaciones s join org_auto_variantes va on va.id = s.variante_id where s.test_id = t.id and s.usuario = p_usuario;
  end if;
  return query select t.id, v.id, v.letra, v.mensaje_apertura, v.boton_apertura, v.mensaje, v.boton_link, v.destino;
end $$;

-- Una fila por DM de apertura con todo su recorrido (base de los reportes). Interna.
create or replace function public.org_auto_filas()
returns table (id bigint, automatizacion text, variante_id bigint, test_id bigint, tipo text, ig_sender text, enviado_at timestamptz,
  ok boolean, paso smallint, reemplazada boolean, toco boolean, respondio_at timestamptz, link_enviado_at timestamptz, comentario_at timestamptz,
  error_txt text, slug text, pieza_id text, clic boolean, clics int, quiz_empezo boolean, quiz_completo boolean, calendario boolean,
  contact_id text, saludo text)
language sql stable security definer set search_path to 'public' as $$
  select m.id, a.nombre, m.variante_id, m.test_id, m.tipo, coalesce(m.ig_sender, m.lead_id::text), m.enviado_at,
    coalesce(m.ok, false), m.paso, m.paso = 3,
    -- tocó/respondió la apertura: lo marca ig-respuestas (respondio_at); antes se deduce del link enviado después de la apertura
    (m.respondio_at is not null or m.error2 is not null or (m.link_enviado_at is not null and m.link_enviado_at > m.enviado_at + interval '20 seconds')),
    m.respondio_at, m.link_enviado_at, c.ocurrio_at,
    case when m.ok is false then m.error when m.error2 is not null then m.error2 end,
    m.slug, k.pieza_id,
    exists (select 1 from org_clics x where x.slug = m.slug), (select count(*)::int from org_clics x where x.slug = m.slug),
    exists (select 1 from quiz_eventos q where q.utms ->> 'utm_term' = m.slug and q.evento = 'empezo'),
    exists (select 1 from quiz_eventos q where q.utms ->> 'utm_term' = m.slug and q.evento = 'diagnostico'),
    exists (select 1 from quiz_eventos q where q.utms ->> 'utm_term' = m.slug and q.evento in ('calendario', 'agendo')),
    coalesce((select g.id from ghl_contacts g where m.slug is not null and g.custom_fields ->> 'UBBOVwiLanwMp4odGPmT' = m.slug limit 1), l.ghl_contact_id),
    coalesce(m.saludo, case when m.texto ~ '^¡Hola @' then 'arroba' when m.texto ~ '^¡Hola!' then 'sin_nombre' when m.texto ~ '^¡Hola [^@!]' then 'nombre_api' end)
  from org_mensajes m
  join org_automatizaciones a on a.id = m.automatizacion_id
  left join org_links k on k.slug = m.slug
  left join org_leads l on l.id = m.lead_id
  left join org_comentarios c on m.comentario_id like 'c:%' and c.id = substr(m.comentario_id, 3)
$$;

-- Embudo por automatización (p_por 'auto'), por publicación ('pieza') o por tipo de saludo ('saludo').
-- Arriba (aperturas → clics → quiz): DMs de apertura con fecha en el período (día de Los Ángeles), y comentarios con
-- palabra del período. Abajo (agendas, asistencias calificadas, cierres, cobrado): MISMAS REGLAS QUE EL RESUMEN vía
-- org_base_base (1ra agenda calificada por fecha de reserva, 1ra asistencia, cierres por fecha de cierre), para las
-- personas que recibieron un link de ese grupo (en cualquier fecha).
create or replace function public.org_auto_embudo(desde date, hasta date, p_por text default 'auto')
returns table (clave text, comentarios int, personas_coment int, aperturas int, fallidas int, reemplazadas int, personas int, repetidos int,
  toques int, links int, link_fallidos int, clics int, clics_total int, quiz_empezo int, quiz_completo int, calendario int,
  agendas int, calificadas int, ventas int, cobrado numeric, seg_apertura numeric, seg_link numeric, errores jsonb)
language sql stable security definer set search_path to 'public' as $$
  with f as (select x.*, case p_por when 'pieza' then coalesce(x.pieza_id, 'sin-pieza') when 'saludo' then coalesce(x.saludo, 'sin dato') else x.automatizacion end g from org_auto_filas() x),
  p as (select * from f where (f.enviado_at at time zone 'America/Los_Angeles')::date between desde and hasta),
  arriba as (
    select p.g, count(*) filter (where p.ok)::int aperturas, count(*) filter (where not p.ok)::int fallidas,
      count(*) filter (where p.ok and p.reemplazada)::int reemplazadas,
      count(distinct p.ig_sender) filter (where p.ok)::int personas,
      (count(*) filter (where p.ok) - count(distinct p.ig_sender) filter (where p.ok))::int repetidos,
      count(*) filter (where p.ok and p.toco)::int toques, count(*) filter (where p.link_enviado_at is not null)::int links,
      count(*) filter (where p.ok and p.toco and p.link_enviado_at is null and p.error_txt is not null)::int link_fallidos,
      count(*) filter (where p.link_enviado_at is not null and p.clic)::int clics, coalesce(sum(p.clics) filter (where p.link_enviado_at is not null), 0)::int clics_total,
      count(*) filter (where p.quiz_empezo)::int quiz_empezo, count(*) filter (where p.quiz_completo)::int quiz_completo, count(*) filter (where p.calendario)::int calendario,
      round((percentile_cont(0.5) within group (order by extract(epoch from p.enviado_at - p.comentario_at)) filter (where p.ok and p.comentario_at is not null and p.enviado_at >= p.comentario_at))::numeric, 1) seg_apertura,
      round((percentile_cont(0.5) within group (order by extract(epoch from p.link_enviado_at - p.respondio_at)) filter (where p.respondio_at is not null and p.link_enviado_at >= p.respondio_at))::numeric, 1) seg_link
    from p group by p.g),
  err as (select x.g, jsonb_object_agg(x.e, x.n) errores from (select p.g, left(regexp_replace(p.error_txt, '^Error: ', ''), 120) e, count(*) n from p where p.error_txt is not null group by 1, 2) x group by x.g),
  com as (
    select case p_por when 'pieza' then c.pieza_id else upper(c.palabra) end g, count(*)::int n, count(distinct c.usuario_norm)::int u
    from org_comentarios c
    where not c.propio and c.palabra is not null and p_por <> 'saludo' and c.parent_id is null
      and (c.ocurrio_at at time zone 'America/Los_Angeles')::date between desde and hasta
      and c.ocurrio_at >= (select min(m.enviado_at) from org_mensajes m) -- desde que responde nuestra app (antes: ManyChat)
    group by 1),
  pers as (select distinct on (f.contact_id) f.contact_id, f.g from f where f.contact_id is not null order by f.contact_id, f.enviado_at desc),
  abajo as (
    select pers.g, count(*) filter (where b.agendo)::int agendas, count(*) filter (where b.califica)::int calificadas,
      coalesce(sum(b.ventas), 0)::int ventas, coalesce(sum(b.cobrado), 0) cobrado
    from pers join org_base_base(desde, hasta) b on b.contact_id = pers.contact_id group by pers.g),
  k as (select arriba.g from arriba union select abajo.g from abajo
        union select com.g from com where p_por = 'auto' and com.g in (select upper(a.nombre) from org_automatizaciones a))
  select k.g, coalesce(com.n, 0), coalesce(com.u, 0), coalesce(arriba.aperturas, 0), coalesce(arriba.fallidas, 0), coalesce(arriba.reemplazadas, 0),
    coalesce(arriba.personas, 0), coalesce(arriba.repetidos, 0), coalesce(arriba.toques, 0), coalesce(arriba.links, 0), coalesce(arriba.link_fallidos, 0),
    coalesce(arriba.clics, 0), coalesce(arriba.clics_total, 0), coalesce(arriba.quiz_empezo, 0), coalesce(arriba.quiz_completo, 0), coalesce(arriba.calendario, 0),
    coalesce(abajo.agendas, 0), coalesce(abajo.calificadas, 0), coalesce(abajo.ventas, 0), coalesce(abajo.cobrado, 0),
    arriba.seg_apertura, arriba.seg_link, coalesce(err.errores, '{}'::jsonb)
  from k left join arriba on arriba.g = k.g left join abajo on abajo.g = k.g left join com on com.g = k.g left join err on err.g = k.g
  where public.vista_total() and k.g is not null
  order by coalesce(arriba.aperturas, 0) desc
$$;

-- Errores de entrega por día (la UI alerta si pasan del 10 %)
create or replace function public.org_auto_alertas(desde date, hasta date)
returns table (dia date, intentos int, fallidas int, pct numeric)
language sql stable security definer set search_path to 'public' as $$
  select x.d, x.n, x.e, round(x.e::numeric / nullif(x.n, 0), 4) from (
    select (f.enviado_at at time zone 'America/Los_Angeles')::date d,
      (count(*) + count(*) filter (where f.ok and f.toco))::int n,
      (count(*) filter (where not f.ok) + count(*) filter (where f.ok and f.toco and f.link_enviado_at is null and f.error_txt is not null))::int e
    from org_auto_filas() f where (f.enviado_at at time zone 'America/Los_Angeles')::date between desde and hasta group by 1) x
  where public.vista_total() order by x.d desc
$$;

-- ───────── gestión de tests (solo desde el dashboard, owners) ─────────
create or replace function public.org_auto_tests_lista()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'automatizacion_id', t.automatizacion_id, 'automatizacion', a.nombre, 'nombre', t.nombre, 'metrica', t.metrica, 'estado', t.estado,
    'iniciado_at', t.iniciado_at, 'cerrado_at', t.cerrado_at, 'ganadora_id', t.ganadora_id, 'notas', t.notas, 'creado_at', t.creado_at,
    'variantes', (select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('asignados', (select count(*) from org_auto_asignaciones s where s.variante_id = v.id)) order by v.letra), '[]'::jsonb) from org_auto_variantes v where v.test_id = t.id)
  ) order by (t.estado = 'cerrado'), t.creado_at desc), '[]'::jsonb)
  from org_auto_tests t join org_automatizaciones a on a.id = t.automatizacion_id where public.vista_total()
$$;

create or replace function public.org_auto_test_crear(p_auto bigint, p_nombre text, p_metrica text default 'clic')
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare a public.org_automatizaciones; t bigint;
begin
  if not public.vista_total() then raise exception 'sin permiso'; end if;
  select * into a from org_automatizaciones where id = p_auto;
  if not found then raise exception 'automatización no existe'; end if;
  if exists (select 1 from org_auto_tests where automatizacion_id = p_auto and estado <> 'cerrado') then raise exception 'Esta automatización ya tiene un test abierto: ciérralo antes de crear otro'; end if;
  insert into org_auto_tests (automatizacion_id, nombre, metrica) values (p_auto, coalesce(nullif(btrim(p_nombre), ''), 'Test ' || a.nombre), coalesce(p_metrica, 'clic')) returning id into t;
  -- A = lo que corre hoy (control); B = copia para editar
  insert into org_auto_variantes (test_id, letra, nombre, mensaje_apertura, boton_apertura, mensaje, boton_link, destino, peso)
  values (t, 'A', 'Control (actual)', a.mensaje_apertura, a.boton_apertura, a.mensaje, a.boton_link, a.destino, 50),
         (t, 'B', 'Variante B', a.mensaje_apertura, a.boton_apertura, a.mensaje, a.boton_link, a.destino, 50);
  return t;
end $$;

create or replace function public.org_auto_variante_guardar(p_id bigint, p_test bigint, p_nombre text, p_apertura text, p_boton_apertura text,
  p_mensaje text, p_boton_link text, p_destino text, p_peso int)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare t public.org_auto_tests; v public.org_auto_variantes; r bigint; nueva text; usado boolean;
begin
  if not public.vista_total() then raise exception 'sin permiso'; end if;
  select * into t from org_auto_tests where id = coalesce(p_test, (select x.test_id from org_auto_variantes x where x.id = p_id));
  if not found then raise exception 'test no existe'; end if;
  if t.estado = 'cerrado' then raise exception 'El test está cerrado: crea uno nuevo'; end if;
  if char_length(coalesce(p_boton_apertura, '')) > 20 or char_length(coalesce(p_boton_link, '')) > 20 then raise exception 'Los botones tienen máximo 20 caracteres'; end if;
  if coalesce(p_mensaje, '') !~ '\{link\}' and coalesce(p_boton_link, '') = '' then raise exception 'El mensaje del link tiene que incluir {link} o el texto del botón del link'; end if;
  if coalesce(p_apertura, '') <> '' and coalesce(p_boton_apertura, '') = '' then raise exception 'La apertura necesita el texto del botón'; end if;
  if p_id is null then
    select chr(ascii(coalesce(max(x.letra), '@')) + 1) into nueva from org_auto_variantes x where x.test_id = t.id;
    insert into org_auto_variantes (test_id, letra, nombre, mensaje_apertura, boton_apertura, mensaje, boton_link, destino, peso)
    values (t.id, nueva, coalesce(nullif(p_nombre, ''), 'Variante ' || nueva), nullif(p_apertura, ''), nullif(p_boton_apertura, ''), p_mensaje, nullif(p_boton_link, ''), nullif(p_destino, ''), coalesce(p_peso, 50))
    returning id into r;
    return r;
  end if;
  select * into v from org_auto_variantes where id = p_id and test_id = t.id;
  if not found then raise exception 'variante no existe'; end if;
  usado := exists (select 1 from org_auto_asignaciones s where s.variante_id = v.id);
  if usado and (coalesce(v.mensaje_apertura, '') <> coalesce(p_apertura, '') or coalesce(v.boton_apertura, '') <> coalesce(p_boton_apertura, '')
      or coalesce(v.mensaje, '') <> coalesce(p_mensaje, '') or coalesce(v.boton_link, '') <> coalesce(p_boton_link, '')
      or coalesce(v.destino, '') <> coalesce(p_destino, '')) then
    raise exception 'Esta variante ya tiene personas asignadas: no se cambia el texto (ensucia el test). Cambia solo el peso o crea otra variante.';
  end if;
  update org_auto_variantes set nombre = coalesce(nullif(p_nombre, ''), nombre), mensaje_apertura = nullif(p_apertura, ''), boton_apertura = nullif(p_boton_apertura, ''),
    mensaje = p_mensaje, boton_link = nullif(p_boton_link, ''), destino = nullif(p_destino, ''), peso = coalesce(p_peso, peso)
  where id = v.id returning id into r;
  return r;
end $$;

create or replace function public.org_auto_variante_quitar(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.vista_total() then raise exception 'sin permiso'; end if;
  if exists (select 1 from org_auto_asignaciones where variante_id = p_id) then raise exception 'Tiene personas asignadas: ponle peso 0 en vez de quitarla'; end if;
  if (select letra from org_auto_variantes where id = p_id) = 'A' then raise exception 'La A es el control'; end if;
  delete from org_auto_variantes where id = p_id;
end $$;

create or replace function public.org_auto_test_estado(p_test bigint, p_estado text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare t public.org_auto_tests;
begin
  if not public.vista_total() then raise exception 'sin permiso'; end if;
  if p_estado not in ('corriendo', 'pausado') then raise exception 'estado inválido'; end if;
  select * into t from org_auto_tests where id = p_test;
  if not found or t.estado = 'cerrado' then raise exception 'test cerrado o inexistente'; end if;
  if p_estado = 'corriendo' and (select count(*) from org_auto_variantes where test_id = p_test and peso > 0) < 2 then raise exception 'Hacen falta al menos 2 variantes con peso'; end if;
  update org_auto_tests set estado = p_estado, iniciado_at = coalesce(iniciado_at, case when p_estado = 'corriendo' then now() end) where id = p_test;
end $$;

-- Cerrar: la ganadora queda como texto de la automatización (desde ahí corre sola = como v13). No borra historial.
create or replace function public.org_auto_test_cerrar(p_test bigint, p_ganadora bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
declare t public.org_auto_tests; v public.org_auto_variantes;
begin
  if not public.vista_total() then raise exception 'sin permiso'; end if;
  select * into t from org_auto_tests where id = p_test;
  if not found or t.estado = 'cerrado' then raise exception 'test cerrado o inexistente'; end if;
  if p_ganadora is not null then
    select * into v from org_auto_variantes where id = p_ganadora and test_id = p_test;
    if not found then raise exception 'la ganadora no es de este test'; end if;
    update org_automatizaciones set mensaje_apertura = coalesce(v.mensaje_apertura, mensaje_apertura), boton_apertura = coalesce(v.boton_apertura, boton_apertura),
      mensaje = coalesce(v.mensaje, mensaje), boton_link = coalesce(v.boton_link, boton_link), destino = coalesce(v.destino, destino)
    where id = t.automatizacion_id;
  end if;
  update org_auto_tests set estado = 'cerrado', cerrado_at = now(), ganadora_id = p_ganadora where id = p_test;
end $$;

-- Reporte por variante (cohorte: personas asignadas en el test; abajo del embudo con org_base_base en la ventana del test)
create or replace function public.org_auto_ab(p_test bigint)
returns table (variante_id bigint, letra text, nombre text, peso int, asignados int, aperturas int, fallidas int, toques int, links int, clics int,
  quiz_completo int, agendas int, calificadas int, ventas int, cobrado numeric)
language sql stable security definer set search_path to 'public' as $$
  with t as (select * from org_auto_tests where id = p_test),
  f as (select * from org_auto_filas() x where x.test_id = p_test),
  pers as (select distinct on (f.contact_id) f.contact_id, f.variante_id from f where f.contact_id is not null order by f.contact_id, f.enviado_at),
  b as (select * from org_base_base((select (coalesce(t.iniciado_at, t.creado_at) at time zone 'America/Los_Angeles')::date from t),
                                    (select (coalesce(t.cerrado_at, now()) at time zone 'America/Los_Angeles')::date from t))),
  abajo as (select pers.variante_id, count(*) filter (where b.agendo)::int ag, count(*) filter (where b.califica)::int ca, coalesce(sum(b.ventas), 0)::int ve, coalesce(sum(b.cobrado), 0) co
            from pers join b on b.contact_id = pers.contact_id group by 1)
  select v.id, v.letra, v.nombre, v.peso,
    (select count(*) from org_auto_asignaciones s where s.variante_id = v.id)::int,
    (select count(*) from f where f.variante_id = v.id and f.ok)::int,
    (select count(*) from f where f.variante_id = v.id and not f.ok)::int,
    (select count(*) from f where f.variante_id = v.id and f.ok and f.toco)::int,
    (select count(*) from f where f.variante_id = v.id and f.link_enviado_at is not null)::int,
    (select count(*) from f where f.variante_id = v.id and f.link_enviado_at is not null and f.clic)::int,
    (select count(*) from f where f.variante_id = v.id and f.quiz_completo)::int,
    coalesce(abajo.ag, 0), coalesce(abajo.ca, 0), coalesce(abajo.ve, 0), coalesce(abajo.co, 0)
  from org_auto_variantes v left join abajo on abajo.variante_id = v.id
  where v.test_id = p_test and public.vista_total() order by v.letra
$$;

-- Recordatorio (apagado por defecto; lo prende el dueño)
create or replace function public.org_auto_recordatorio_guardar(p_auto bigint, p_activo boolean, p_horas int, p_texto text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.vista_total() then raise exception 'sin permiso'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 22 then raise exception 'Las horas van de 1 a 22 (ventana de 24 h de Meta)'; end if;
  if p_activo and coalesce(btrim(p_texto), '') = '' then raise exception 'Falta el texto del recordatorio'; end if;
  update org_automatizaciones set recordatorio_activo = coalesce(p_activo, false), recordatorio_horas = p_horas, recordatorio_texto = nullif(btrim(p_texto), '') where id = p_auto;
end $$;

-- permisos: internas solo service_role; las del dashboard para authenticated (chequean vista_total adentro)
revoke all on function public.org_nombre_pila(text, text) from public, anon, authenticated;
revoke all on function public.org_auto_asignar(bigint, text) from public, anon, authenticated;
revoke all on function public.org_auto_filas() from public, anon, authenticated;
grant execute on function public.org_nombre_pila(text, text), public.org_auto_asignar(bigint, text), public.org_auto_filas() to service_role;
revoke all on function public.org_auto_embudo(date, date, text), public.org_auto_alertas(date, date), public.org_auto_tests_lista(),
  public.org_auto_test_crear(bigint, text, text), public.org_auto_variante_guardar(bigint, bigint, text, text, text, text, text, text, int),
  public.org_auto_variante_quitar(bigint), public.org_auto_test_estado(bigint, text), public.org_auto_test_cerrar(bigint, bigint),
  public.org_auto_ab(bigint), public.org_auto_recordatorio_guardar(bigint, boolean, int, text) from public, anon;
grant execute on function public.org_auto_embudo(date, date, text), public.org_auto_alertas(date, date), public.org_auto_tests_lista(),
  public.org_auto_test_crear(bigint, text, text), public.org_auto_variante_guardar(bigint, bigint, text, text, text, text, text, text, int),
  public.org_auto_variante_quitar(bigint), public.org_auto_test_estado(bigint, text), public.org_auto_test_cerrar(bigint, bigint),
  public.org_auto_ab(bigint), public.org_auto_recordatorio_guardar(bigint, boolean, int, text) to authenticated;

-- ───────── v2 (aplicada 28-11 como org_nombre_pila_v2): más nombres, nombres que también son palabras, prefijos ─────────
insert into public.org_nombres_pila (clave, nombre) values ('catherine','Catherine'),('yesica','Yesica'),('jesica','Jésica'),('manu','Manu'),('sabrina','Sabrina'),('sabri','Sabri'),('mauge','Mauge'),('marce','Marce'),('fran','Fran'),('nico','Nico'),('robinson','Robinson'),('jimena','Jimena'),('maiky','Maiky'),('leonor','Leonor'),('yonathan','Yonathan'),('amaury','Amaury') on conflict do nothing;
alter table public.org_nombres_pila add column if not exists es_palabra boolean not null default false;
update public.org_nombres_pila set es_palabra = true where clave in ('esperanza','aurora','gloria','paloma','violeta','dulce','alma','rosa','victoria','celeste','mercedes','dolores','pilar','rosario','milagros','concepcion','natividad','amparo','domingo','salvador','angeles','regina','franco','clara','blanca','iris','lisa','ella','mary','ruby','linda','angel','cristal','fidel','alba','estela','lucrecia','america','marina','selena','ariel','dante','bruno','simon','ivana');

create or replace function public.org_nombre_pila(p_name text, p_username text)
returns table (nombre text, tipo text) language plpgsql stable security definer set search_path to 'public' as $$
declare tok text; toks text[]; i int; r text; pre text;
begin
  -- 1) name del perfil: primer token, solo letras (saca emojis y números)
  tok := regexp_replace(split_part(btrim(coalesce(p_name, '')), ' ', 1), '[^[:alpha:]''-]', '', 'g');
  if length(tok) >= 2 then
    return query select upper(left(tok, 1)) || lower(substr(tok, 2)), 'nombre_api'::text; return;
  end if;
  -- 2) del usuario: tokens alfabéticos; se prueba el token y el token sin prefijo (soy, dra, dr, lic, ing, coach, its, iam, im, the, mr)
  toks := regexp_split_to_array(lower(coalesce(p_username, '')), '[^a-z]+');
  for i in 1 .. least(coalesce(array_length(toks, 1), 0), 4) loop
    foreach pre in array array['', 'soy', 'dra', 'dr', 'lic', 'ing', 'coach', 'its', 'iam', 'im', 'the', 'mr', 'mrs', 'ms'] loop
      continue when pre <> '' and toks[i] not like pre || '%';
      tok := substr(toks[i], length(pre) + 1);
      continue when length(tok) < 3 or length(tok) > 20;
      r := null;
      select n.nombre into r from org_nombres_pila n where n.clave = tok and length(tok) <= 12;
      if r is null then
        select n.nombre into r from org_nombres_pila n
         where length(n.clave) >= 4 and tok like n.clave || '%' and length(tok) - length(n.clave) between 1 and 3
         order by length(n.clave) desc limit 1;
      end if;
      if r is null then
        select n.nombre into r from org_nombres_pila n
         where length(n.clave) >= 4 and not n.es_palabra and tok like n.clave || '%' and length(tok) - length(n.clave) >= 4
         order by length(n.clave) desc limit 1;
      end if;
      if r is not null then return query select r, 'nombre_usuario'::text; return; end if;
    end loop;
  end loop;
  return query select ''::text, 'sin_nombre'::text;
end $$;
revoke all on function public.org_nombre_pila(text, text) from public, anon, authenticated;
grant execute on function public.org_nombre_pila(text, text) to service_role;
