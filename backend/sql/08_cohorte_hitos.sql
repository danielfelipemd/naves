-- =====================================================
-- NAVES INALDE — Cronograma de 13 hitos por cohorte
-- =====================================================

CREATE TABLE IF NOT EXISTS cohorte_hitos (
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id) ON DELETE CASCADE,
    posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 13),
    nombre VARCHAR(100) NOT NULL,
    fecha DATE NULL,
    PRIMARY KEY (cohorte_id, posicion)
);

-- Seed: rellena los 13 hitos vacíos para toda cohorte existente que aún no los tenga.
WITH hitos_catalogo(posicion, nombre) AS (
    VALUES
        (1,  'Kick Off / Lanzamiento'),
        (2,  'Entrega Anteproyecto'),
        (3,  'Publicación profesores asignados y agendas'),
        (4,  'Ventana Reunión 1 — Inicio'),
        (5,  'Ventana Reunión 1 — Cierre'),
        (6,  'Fecha límite cambios (modalidad/equipo/proyecto)'),
        (7,  'Ventana Reunión 2 — Inicio'),
        (8,  'Ventana Reunión 2 — Cierre'),
        (9,  'Reunión grupal "60 días antes"'),
        (10, 'Entrega Final (Business Plan + Resumen + Logo)'),
        (11, 'Reunión preparación presentación'),
        (12, 'Primera jornada presentaciones (ANCLA)'),
        (13, 'Segunda jornada presentaciones')
)
INSERT INTO cohorte_hitos (cohorte_id, posicion, nombre, fecha)
SELECT c.id, h.posicion, h.nombre, NULL
FROM cohortes c
CROSS JOIN hitos_catalogo h
ON CONFLICT (cohorte_id, posicion) DO NOTHING;

-- Trigger: al crear una nueva cohorte, sembrarle automáticamente sus 13 hitos vacíos
CREATE OR REPLACE FUNCTION fn_seed_cohorte_hitos()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO cohorte_hitos (cohorte_id, posicion, nombre, fecha)
    VALUES
        (NEW.id, 1,  'Kick Off / Lanzamiento', NULL),
        (NEW.id, 2,  'Entrega Anteproyecto', NULL),
        (NEW.id, 3,  'Publicación profesores asignados y agendas', NULL),
        (NEW.id, 4,  'Ventana Reunión 1 — Inicio', NULL),
        (NEW.id, 5,  'Ventana Reunión 1 — Cierre', NULL),
        (NEW.id, 6,  'Fecha límite cambios (modalidad/equipo/proyecto)', NULL),
        (NEW.id, 7,  'Ventana Reunión 2 — Inicio', NULL),
        (NEW.id, 8,  'Ventana Reunión 2 — Cierre', NULL),
        (NEW.id, 9,  'Reunión grupal "60 días antes"', NULL),
        (NEW.id, 10, 'Entrega Final (Business Plan + Resumen + Logo)', NULL),
        (NEW.id, 11, 'Reunión preparación presentación', NULL),
        (NEW.id, 12, 'Primera jornada presentaciones (ANCLA)', NULL),
        (NEW.id, 13, 'Segunda jornada presentaciones', NULL)
    ON CONFLICT (cohorte_id, posicion) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_cohorte_hitos ON cohortes;
CREATE TRIGGER trg_seed_cohorte_hitos
    AFTER INSERT ON cohortes
    FOR EACH ROW EXECUTE FUNCTION fn_seed_cohorte_hitos();
