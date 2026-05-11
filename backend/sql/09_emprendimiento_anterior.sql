-- =====================================================
-- NAVES INALDE — Cambiar "quiebra" (si/no/na) por 5 estados del emprendimiento anterior
-- Nuevos valores:
--   nunca_despego   → Nunca despegó
--   funcionamiento  → Está en funcionamiento
--   vendido         → Lo vendí
--   quebro          → Se quebró
--   na              → N/A
-- =====================================================

-- 1) Quitar el CHECK viejo y ampliar tipo (varchar(10) no admite 'funcionamiento' [14] ni 'nunca_despego' [13])
ALTER TABLE miembros_equipo DROP CONSTRAINT IF EXISTS miembros_equipo_quiebra_check;
ALTER TABLE miembros_equipo ALTER COLUMN quiebra TYPE VARCHAR(20);

-- 2) Migrar data legacy: si→quebro, no→funcionamiento, na→na
UPDATE miembros_equipo SET quiebra = 'quebro'         WHERE quiebra = 'si';
UPDATE miembros_equipo SET quiebra = 'funcionamiento' WHERE quiebra = 'no';
-- 'na' queda igual

-- 3) Nuevo CHECK constraint con 5 valores
ALTER TABLE miembros_equipo
    ADD CONSTRAINT miembros_equipo_quiebra_check
    CHECK (quiebra IN ('nunca_despego', 'funcionamiento', 'vendido', 'quebro', 'na'));

COMMENT ON COLUMN miembros_equipo.quiebra IS
    'Estado del emprendimiento anterior. Solo aplica si fue_emprendedor=true. Valores: nunca_despego, funcionamiento, vendido, quebro, na.';

COMMENT ON COLUMN miembros_equipo.aprendizajes_quiebra IS
    'Texto libre con los aprendizajes. Solo se rellena cuando quiebra=quebro.';
