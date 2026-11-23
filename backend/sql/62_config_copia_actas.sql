-- 62 — Copia automática de las actas firmadas, configurable por el super admin.
--
-- Cuando un acta queda con TODAS sus firmas, el sistema manda una copia en PDF
-- a los correos configurados para su modalidad. Lo pidió Daniel el 23/11/2026
-- para las actas de Caso (coordinación: Ernesto Barrera y Cindy Pinzón), y que
-- el super admin pueda cambiar esos correos desde el panel de Actas.
--
-- config_sistema: ajustes generales clave → valor (jsonb). Solo la usa el
-- backend con la llave de servicio, por eso RLS activo y sin políticas.
--
-- Idempotente. Aditivo: no toca datos existentes.

create table if not exists config_sistema (
  clave          text primary key,
  valor          jsonb not null,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);
alter table config_sistema enable row level security;

insert into config_sistema (clave, valor, actualizado_por)
values (
  'actas_copia_firmadas',
  '{"caso": ["ernesto.barrera@inalde.edu.co", "cindy.pinzon@inalde.edu.co"], "business_plan": [], "proyecto_investigacion": []}'::jsonb,
  'migración 62'
)
on conflict (clave) do nothing;

comment on table config_sistema is 'Ajustes generales del sistema (clave → valor jsonb). actas_copia_firmadas: correos que reciben copia de cada acta completa, por modalidad.';

notify pgrst, 'reload schema';
