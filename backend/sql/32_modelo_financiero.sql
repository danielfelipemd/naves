-- =====================================================================
-- 32_modelo_financiero.sql — Assets del proyecto cargados por el participante
--
-- El equipo de Business Plan entrega, junto al proyecto final, material de
-- apoyo que alimenta la programación de presentaciones: one pager, logo y el
-- modelo financiero (Excel). El one pager y el logo ya vivían en
-- proyecto_contenido (los subía el admin en el Módulo C); ahora también los
-- carga el propio participante desde su pantalla de proyecto de grado.
--
-- El modelo financiero es nuevo: se guarda como PATH en el mismo bucket privado
-- (naves/<proyecto_id>/modelo_financiero.xlsx) y se sirve por el proxy con token
-- efímero, igual que el resto de assets.
-- =====================================================================

ALTER TABLE proyecto_contenido ADD COLUMN IF NOT EXISTS modelo_financiero_path TEXT;

COMMENT ON COLUMN proyecto_contenido.modelo_financiero_path IS
    'Path en Storage del modelo financiero (Excel) del proyecto, cargado por el participante. Se sirve por el proxy de archivos.';
