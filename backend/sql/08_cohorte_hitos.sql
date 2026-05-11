-- =====================================================
-- NAVES INALDE — Cronograma de 11 hitos por cohorte
-- =====================================================

CREATE TABLE IF NOT EXISTS cohorte_hitos (
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id) ON DELETE CASCADE,
    posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 11),
    nombre VARCHAR(100) NOT NULL,
    fecha DATE NULL,
    PRIMARY KEY (cohorte_id, posicion)
);

-- Seed: rellena los 11 hitos vacíos para toda cohorte existente que aún no los tenga.
WITH hitos_catalogo(posicion, nombre) AS (
    VALUES
        (1, 'Kick Off / Lanzamiento'),
        (2, 'Entrega Anteproyecto'),
        (3, 'Asignación de Profesores'),
        (4, 'Inicio Ventana Reunión 1'),
        (5, 'Cierre Ventana Reunión 1'),
        (6, 'Inicio Ventana Reunión 2'),
        (7, 'Cierre Ventana Reunión 2'),
        (8, 'Reunión 60 días antes'),
        (9, 'Entrega Final'),
        (10, 'Presentaciones día 1'),
        (11, 'Presentaciones día 2')
)
INSERT INTO cohorte_hitos (cohorte_id, posicion, nombre, fecha)
SELECT c.id, h.posicion, h.nombre, NULL
FROM cohortes c
CROSS JOIN hitos_catalogo h
ON CONFLICT (cohorte_id, posicion) DO NOTHING;

-- Trigger: al crear una nueva cohorte, sembrarle automáticamente sus 11 hitos vacíos
CREATE OR REPLACE FUNCTION fn_seed_cohorte_hitos()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO cohorte_hitos (cohorte_id, posicion, nombre, fecha)
    VALUES
        (NEW.id, 1, 'Kick Off / Lanzamiento', NULL),
        (NEW.id, 2, 'Entrega Anteproyecto', NULL),
        (NEW.id, 3, 'Asignación de Profesores', NULL),
        (NEW.id, 4, 'Inicio Ventana Reunión 1', NULL),
        (NEW.id, 5, 'Cierre Ventana Reunión 1', NULL),
        (NEW.id, 6, 'Inicio Ventana Reunión 2', NULL),
        (NEW.id, 7, 'Cierre Ventana Reunión 2', NULL),
        (NEW.id, 8, 'Reunión 60 días antes', NULL),
        (NEW.id, 9, 'Entrega Final', NULL),
        (NEW.id, 10, 'Presentaciones día 1', NULL),
        (NEW.id, 11, 'Presentaciones día 2', NULL)
    ON CONFLICT (cohorte_id, posicion) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_cohorte_hitos ON cohortes;
CREATE TRIGGER trg_seed_cohorte_hitos
    AFTER INSERT ON cohortes
    FOR EACH ROW EXECUTE FUNCTION fn_seed_cohorte_hitos();
