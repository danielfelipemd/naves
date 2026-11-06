-- 51 · Una sola corrección por documento en la entrega final del Business Plan.
--
-- Pedido por Daniel (06/11/2026): si el participante sube el archivo equivocado,
-- puede reemplazarlo UNA vez desde la misma pantalla, hasta la fecha límite.
-- Después queda definitivo. Solo Business Plan (Caso/PI siguen sin reemplazo).
--
-- *_reemplazado_at : cuándo se usó el reemplazo (NULL = todavía disponible).
--                    El backend lo reserva con un UPDATE condicional antes de
--                    subir el archivo nuevo: dos peticiones a la vez no pueden
--                    gastar dos reemplazos.
-- *_path_anterior  : copia del archivo reemplazado en Storage (carpeta
--                    reemplazados/), para que quede evidencia de lo que había.
--
-- Solo agrega columnas que admiten NULL: el código anterior no las lee y sigue
-- funcionando igual. Orden de despliegue: este SQL → backend → frontend.

alter table public.anteproyectos
  add column if not exists archivo_proyecto_final_reemplazado_at timestamptz,
  add column if not exists archivo_proyecto_final_path_anterior text;

alter table public.proyecto_contenido
  add column if not exists one_pager_reemplazado_at timestamptz,
  add column if not exists one_pager_path_anterior text,
  add column if not exists logo_reemplazado_at timestamptz,
  add column if not exists logo_path_anterior text,
  add column if not exists modelo_financiero_reemplazado_at timestamptz,
  add column if not exists modelo_financiero_path_anterior text;

comment on column public.anteproyectos.archivo_proyecto_final_reemplazado_at is
  'Business Plan: cuándo usó el participante su único reemplazo del PDF final (NULL = disponible).';
comment on column public.proyecto_contenido.one_pager_reemplazado_at is
  'Cuándo usó el participante su único reemplazo del One Pager (NULL = disponible).';
comment on column public.proyecto_contenido.logo_reemplazado_at is
  'Cuándo usó el participante su único reemplazo del logo (NULL = disponible).';
comment on column public.proyecto_contenido.modelo_financiero_reemplazado_at is
  'Cuándo usó el participante su único reemplazo del modelo financiero (NULL = disponible).';
