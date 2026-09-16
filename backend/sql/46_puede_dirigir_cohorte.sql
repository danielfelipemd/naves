-- 46 — Quién puede ser Director de Cohorte (el que firma el cierre de las actas).
--
-- Antes el desplegable de "Config Director de Cohorte" se deducía leyendo las
-- tablas de profesores y directores enteras: salían 22-24 opciones, incluidas
-- las cuentas de prueba y el propio super admin. Deducirlo nunca iba a funcionar
-- porque "ser profesor" no es lo mismo que "poder firmar el cierre de una
-- cohorte": es un encargo que se asigna, no un atributo de la persona.
--
-- OJO: el Director de Cohorte NO es el director de un Caso o de un Proyecto de
-- Investigación. Ese dirige UN trabajo de grado y firma solo las actas de su
-- proyecto; este firma el cierre de TODAS las actas de la cohorte.
--
-- Ahora es una marca que el super admin controla desde el panel.

alter table profesores  add column if not exists puede_dirigir_cohorte boolean not null default false;
alter table directores  add column if not exists puede_dirigir_cohorte boolean not null default false;

comment on column profesores.puede_dirigir_cohorte is
  'Puede ser Director de Cohorte (firma el cierre de todas las actas). Lo marca el super admin.';
comment on column directores.puede_dirigir_cohorte is
  'Puede ser Director de Cohorte (firma el cierre de todas las actas). Lo marca el super admin.';

-- Arranque: quien ya está configurado como director de cohorte en alguna
-- cohorte queda marcado, para no perder lo que ya se había elegido a mano.
update directores d set puede_dirigir_cohorte = true
where exists (
  select 1 from cohortes c
  where c.director_mba_nombre is not null
    and lower(trim(c.director_mba_nombre)) = lower(trim(d.nombre_completo))
);

update profesores p set puede_dirigir_cohorte = true
where p.es_super_admin = false
  and exists (
    select 1 from cohortes c
    where c.director_mba_nombre is not null
      and lower(trim(c.director_mba_nombre)) = lower(trim(p.nombre_completo))
  )
  -- si la misma persona está en directores, ahí ya quedó marcada
  and not exists (select 1 from directores d where lower(trim(d.nombre_completo)) = lower(trim(p.nombre_completo)));
