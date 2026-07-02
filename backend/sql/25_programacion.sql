-- =====================================================================
-- 25_programacion.sql — Módulo B (Fase 2): Calendario / Programación
-- Asignación de proyectos a slots por jornada + cálculo de horarios.
-- Adaptación del prototipo programador.html.
-- =====================================================================

-- Config de programación por cohorte (minutos y bloque para breaks).
CREATE TABLE IF NOT EXISTS programacion_config (
    cohorte_id VARCHAR(20) PRIMARY KEY REFERENCES cohortes(id) ON DELETE CASCADE,
    evento_nombre VARCHAR(120) NOT NULL DEFAULT 'NAVES',
    expo_min INT NOT NULL DEFAULT 20,     -- duración de cada exposición
    trans_min INT NOT NULL DEFAULT 5,     -- transición entre slots
    foto_min INT NOT NULL DEFAULT 10,     -- foto inicial de grupo
    cierre_min INT NOT NULL DEFAULT 20,   -- cierre / foto final
    break_min INT NOT NULL DEFAULT 30,    -- duración del break automático
    bloque INT NOT NULL DEFAULT 5,        -- presentaciones por bloque antes de un break
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Config de programación a nivel de jornada.
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS foto_inicial BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS intro_min INT NOT NULL DEFAULT 0;

-- Slots de presentación: qué equipo (proyecto) va en qué posición de la jornada.
-- hora_inicio/hora_fin se calculan al guardar y se persisten (los consume el
-- portal del participante — Módulo C).
CREATE TABLE IF NOT EXISTS slot_presentacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jornada_id UUID NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
    orden INT NOT NULL,
    equipo_id UUID REFERENCES equipos(id) ON DELETE SET NULL,
    hora_inicio TIME,
    hora_fin TIME,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (jornada_id, orden)
);
CREATE INDEX IF NOT EXISTS idx_slot_jornada ON slot_presentacion(jornada_id);
CREATE INDEX IF NOT EXISTS idx_slot_equipo ON slot_presentacion(equipo_id);

ALTER TABLE programacion_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_presentacion   ENABLE ROW LEVEL SECURITY;
