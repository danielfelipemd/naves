-- =====================================================================
-- 30_reunion_profesor.sql — El profesor registra en la sábana si ya tuvo la
-- Reunión 1 y la Reunión 2 con cada equipo.
--
-- OJO: NO se reutiliza equipos.reunion_1_marcada_por. Esa marca la pone el
-- PARTICIPANTE y es la que le desbloquea la selección del proyecto definitivo
-- (ver routes/seleccion.ts). Son dos hechos distintos con dos actores distintos:
-- mezclarlos haría que marcar asistencia le abriera la selección al equipo.
-- =====================================================================

ALTER TABLE equipos ADD COLUMN IF NOT EXISTS reunion_1_profesor_at TIMESTAMPTZ;
ALTER TABLE equipos ADD COLUMN IF NOT EXISTS reunion_1_profesor_id UUID REFERENCES profesores(id);
ALTER TABLE equipos ADD COLUMN IF NOT EXISTS reunion_2_profesor_at TIMESTAMPTZ;
ALTER TABLE equipos ADD COLUMN IF NOT EXISTS reunion_2_profesor_id UUID REFERENCES profesores(id);

COMMENT ON COLUMN equipos.reunion_1_profesor_at IS 'Cuándo el profesor registró que tuvo la Reunión 1 con el equipo. NULL = no marcada.';
COMMENT ON COLUMN equipos.reunion_2_profesor_at IS 'Cuándo el profesor registró que tuvo la Reunión 2 con el equipo. NULL = no marcada.';
