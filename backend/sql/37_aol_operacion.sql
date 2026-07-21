-- =====================================================================
-- 37_aol_operacion.sql — Tablas de operación del módulo AoL (Fase 1, §2.3)
--
-- El esquema+datos histórico de AoL (14 tablas + v_resumen) se replicó desde el
-- proyecto aol-naves en 36_aol_schema_y_datos.sql. Esta migración agrega las DOS
-- tablas que la plataforma escribe: aol_analisis (una corrida del pipeline §7) y
-- aol_calificacion (la firma humana, R7).
--
-- RLS: se activa (niega acceso directo). NO se crean políticas para el rol
-- `authenticated` como sugiere el §5 del spec, porque esa plataforma NO usa
-- Supabase Auth: todo el acceso a datos va por el backend Node con service_role
-- (que bypasea RLS) y valida el rol NAVES antes de servir. Es la misma postura
-- del resto del sistema y es más restrictiva que las políticas del ejemplo.
-- =====================================================================

-- Análisis IA por trabajo (una corrida del pipeline §7)
create table if not exists aol_analisis (
  id bigint generated always as identity primary key,
  proyecto_plataforma_id text not null,      -- id del trabajo (proyecto definitivo) en la plataforma
  cohorte_codigo text not null,
  bp_pdf_hash text not null,                 -- sha256 de los archivos evaluados (R8)
  modelo_xlsx_hash text not null,
  quick_screen jsonb not null,               -- resultado de compuertas (§7.2)
  resultado jsonb not null,                  -- salida completa del agente (schema §7.5)
  version_cerebro text not null,
  estado text not null check (estado in ('sugerencia','descartado')) default 'sugerencia',
  creado_en timestamptz default now()
);

-- Calificación firmada por trabajo (la decisión humana, R7)
create table if not exists aol_calificacion (
  id bigint generated always as identity primary key,
  proyecto_plataforma_id text not null,
  cohorte_codigo text not null,
  analisis_id bigint references aol_analisis(id),
  puntajes jsonb not null,                   -- {"1":2,"2":3,...} trait -> puntaje final
  parrafo text not null,                     -- párrafo de calificación (editado y firmado)
  total int not null, on_standard boolean not null,
  autor text not null,                       -- profesor que firma
  firmado_en timestamptz default now(),
  version_cerebro text not null, version_rubrica text not null,
  unique (proyecto_plataforma_id)
);

alter table aol_analisis enable row level security;
alter table aol_calificacion enable row level security;

-- Índices de consulta habituales del módulo.
create index if not exists idx_aol_analisis_proyecto on aol_analisis (proyecto_plataforma_id);
create index if not exists idx_aol_analisis_estado on aol_analisis (estado);
create index if not exists idx_aol_calificacion_cohorte on aol_calificacion (cohorte_codigo);
