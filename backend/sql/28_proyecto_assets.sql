-- =====================================================================
-- 28_proyecto_assets.sql — Módulo F (Fase 2): Migración de archivos a la nube
-- Guarda el PATH en Supabase Storage (bucket privado 'trabajos-grado', prefijo
-- naves/<proyecto_id>/...) del logo y el one pager de cada proyecto. Se sirven
-- vía el proxy con token efímero (/api/archivos/stream), igual que los trabajos
-- de grado. Las columnas *_url ya existentes quedan para enlaces externos.
-- =====================================================================

ALTER TABLE proyecto_contenido ADD COLUMN IF NOT EXISTS one_pager_path TEXT;
ALTER TABLE proyecto_contenido ADD COLUMN IF NOT EXISTS logo_path TEXT;
