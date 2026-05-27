-- =====================================================
-- Sábana de proyectos: flags a nivel de equipo
-- =====================================================
ALTER TABLE equipos
  ADD COLUMN IF NOT EXISTS buscando_socios BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS buscando_asociacion_otro_proyecto BOOLEAN NULL;

COMMENT ON COLUMN equipos.buscando_socios IS
  'Sábana de proyectos: el equipo busca incorporar más socios. NULL = no contestado.';
COMMENT ON COLUMN equipos.buscando_asociacion_otro_proyecto IS
  'Sábana de proyectos: el equipo busca asociarse a otro proyecto. NULL = no contestado.';
