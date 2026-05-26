-- Mueve el perfil emprendedor desde miembros_equipo a participantes_lista.
-- Cada participante de business_plan llena esto UNA vez antes de formar equipo.

-- Columnas nuevas en participantes_lista
ALTER TABLE participantes_lista
  ADD COLUMN IF NOT EXISTS perfil VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS fue_emprendedor BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS quiebra VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS aprendizajes_quiebra TEXT NULL,
  ADD COLUMN IF NOT EXISTS perfil_completo_at TIMESTAMPTZ NULL;

-- Constraints (drop si existen para reaplicar)
ALTER TABLE participantes_lista DROP CONSTRAINT IF EXISTS participantes_lista_perfil_check;
ALTER TABLE participantes_lista
  ADD CONSTRAINT participantes_lista_perfil_check
  CHECK (perfil IS NULL OR perfil IN ('emprendedor','directivo','ambos'));

ALTER TABLE participantes_lista DROP CONSTRAINT IF EXISTS participantes_lista_quiebra_check;
ALTER TABLE participantes_lista
  ADD CONSTRAINT participantes_lista_quiebra_check
  CHECK (quiebra IS NULL OR quiebra IN ('nunca_despego','funcionamiento','vendido','quebro','na'));

-- Emociones del participante (independiente del equipo)
CREATE TABLE IF NOT EXISTS participante_emociones (
  participante_id UUID NOT NULL REFERENCES participantes_lista(id) ON DELETE CASCADE,
  emocion VARCHAR(20) NOT NULL CHECK (emocion IN ('crear','dinero','problema','autonomia','ninguna')),
  PRIMARY KEY (participante_id, emocion)
);

-- Preocupaciones del participante
CREATE TABLE IF NOT EXISTS participante_preocupaciones (
  participante_id UUID NOT NULL REFERENCES participantes_lista(id) ON DELETE CASCADE,
  preocupacion VARCHAR(20) NOT NULL CHECK (preocupacion IN ('financiera','estres','habilidades','familia','ninguna')),
  PRIMARY KEY (participante_id, preocupacion)
);
