-- =====================================================================
-- 39_avance_casopi.sql — Entrega intermedia ("avance") para Caso y
-- Proyecto de Investigación
--
-- Estas dos modalidades pasan de dos entregables (anteproyecto → proyecto
-- final) a TRES: anteproyecto → AVANCE → proyecto final. El avance es un PDF
-- de una sola carga, no reemplazable (como el proyecto final), obligatorio y
-- secuencial: exige el anteproyecto, y a su vez habilita el proyecto final.
-- Business Plan NO usa este entregable.
--
-- La fecha límite del avance es una nueva fecha operativa por cohorte
-- (fecha+hora, TIMESTAMPTZ), paralela a fecha_limite_proyecto_final. Se usa
-- como objetivo/advertencia (no bloquea la carga tardía).
-- =====================================================================

ALTER TABLE anteproyectos
    ADD COLUMN IF NOT EXISTS archivo_avance_path TEXT NULL,
    ADD COLUMN IF NOT EXISTS archivo_avance_mime TEXT NULL,
    ADD COLUMN IF NOT EXISTS archivo_avance_size_bytes INTEGER NULL,
    ADD COLUMN IF NOT EXISTS archivo_avance_uploaded_at TIMESTAMPTZ NULL;

ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS fecha_limite_avance TIMESTAMPTZ;

COMMENT ON COLUMN cohortes.fecha_limite_avance IS
    'Fecha y hora límite (objetivo) de la entrega intermedia ("avance") de Caso y Proyecto de Investigación. Entre la del anteproyecto y la del proyecto final.';
