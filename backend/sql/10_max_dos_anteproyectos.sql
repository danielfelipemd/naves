-- =====================================================
-- NAVES INALDE — Máximo 2 anteproyectos por equipo (antes 3)
-- =====================================================

-- 0) Salvaguarda: rechazar la migración si hay proyectos con posicion=3
DO $$
DECLARE
    n INT;
BEGIN
    SELECT COUNT(*) INTO n FROM proyectos WHERE posicion = 3;
    IF n > 0 THEN
        RAISE EXCEPTION 'No se puede aplicar: hay % proyecto(s) con posicion=3. Revisa la data antes de continuar.', n;
    END IF;
END $$;

-- 1) Reemplazar el CHECK de posicion: 1..3 → 1..2
ALTER TABLE proyectos DROP CONSTRAINT IF EXISTS proyectos_posicion_check;
ALTER TABLE proyectos
    ADD CONSTRAINT proyectos_posicion_check
    CHECK (posicion BETWEEN 1 AND 2);

COMMENT ON COLUMN proyectos.posicion IS
    'Posición del proyecto dentro del anteproyecto. Máximo 2 proyectos por equipo.';
