-- =====================================================================
-- 33_fecha_limite_proyecto_final.sql — Fecha+hora de la entrega final
--
-- El corte para cargar el proyecto de grado (documento + material) salía del
-- hito 10 del cronograma, que es solo FECHA (cohorte_hitos.fecha DATE). Faltaba
-- la HORA. Las otras 4 fechas operativas de la cohorte ya son fecha+hora
-- (TIMESTAMPTZ); esta se suma a ese grupo, editable en el mismo lugar.
--
-- Si queda sin configurar, el backend cae al hito 10 a fin del día (Bogotá).
-- =====================================================================

ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS fecha_limite_proyecto_final TIMESTAMPTZ;

COMMENT ON COLUMN cohortes.fecha_limite_proyecto_final IS
    'Fecha y hora límite para cargar el proyecto de grado (documento final + material). Si es NULL, se usa el hito 10 del cronograma a fin del día.';
