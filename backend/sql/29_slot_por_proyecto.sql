-- =====================================================================
-- 29_slot_por_proyecto.sql — Fase 2: la unidad es el PROYECTO, no el equipo.
--
-- La Fase 2 (panelistas, programación, base de datos interna, contenido IA)
-- ocurre DESPUÉS de la selección del proyecto definitivo. Colgar los slots del
-- equipo obligaba a atravesar el anteproyecto para saber qué se presenta, y un
-- equipo sin selección hecha aparecía programado con todas sus ideas
-- concatenadas ("Idea A / Idea B"). El slot pasa a apuntar al proyecto.
--
-- Un equipo sin proyecto definitivo NO entra a la Fase 2: su slot queda en NULL.
-- =====================================================================

ALTER TABLE slot_presentacion
    ADD COLUMN IF NOT EXISTS proyecto_id UUID REFERENCES proyectos(id) ON DELETE SET NULL;

-- Backfill: cada slot apunta ahora al proyecto definitivo del equipo que tenía.
-- Los equipos sin definitivo dejan el slot vacío (quedan fuera de la Fase 2).
UPDATE slot_presentacion sp
   SET proyecto_id = e.proyecto_definitivo_id
  FROM equipos e
 WHERE e.id = sp.equipo_id
   AND sp.proyecto_id IS NULL
   AND e.proyecto_definitivo_id IS NOT NULL;

DROP INDEX IF EXISTS idx_slot_equipo;
ALTER TABLE slot_presentacion DROP COLUMN IF EXISTS equipo_id;

CREATE INDEX IF NOT EXISTS idx_slot_proyecto ON slot_presentacion(proyecto_id);

-- Un proyecto se presenta una sola vez en todo el evento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_proyecto
    ON slot_presentacion(proyecto_id) WHERE proyecto_id IS NOT NULL;
