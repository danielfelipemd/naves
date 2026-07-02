-- =====================================================================
-- 24_panelistas.sql — Módulo A (Fase 2): Panelistas / Evaluadores
-- Portal de confirmación de asistencia + logística (transporte y comidas)
-- Adaptación del prototipo panelistas.html + admin.html a la plataforma.
-- =====================================================================

-- Jornadas de presentación del evento NAVES, por cohorte.
-- (Distinto de cohorte_hitos, que son los hitos del programa académico.)
CREATE TABLE IF NOT EXISTS jornadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id) ON DELETE CASCADE,
    numero INT NOT NULL,
    fecha DATE NOT NULL,
    hora_inicio TIME,
    hora_fin TIME,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (cohorte_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_jornadas_cohorte ON jornadas(cohorte_id);

-- Panelistas (evaluadores externos) por cohorte.
-- Confirmación y token de acceso consolidados aquí para minimizar joins.
-- Email cifrado siguiendo el patrón PII del sistema.
CREATE TABLE IF NOT EXISTS panelistas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id) ON DELETE CASCADE,
    nombre_completo VARCHAR(150) NOT NULL,
    email_encriptado TEXT NOT NULL,
    email_hash VARCHAR(64) NOT NULL,
    asiste_todas BOOLEAN NOT NULL DEFAULT FALSE,  -- true = asiste a todas las jornadas
    -- Token UUID para el portal del panelista (link sin login)
    token_confirmacion VARCHAR(64) UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    confirmado BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_confirmacion TIMESTAMPTZ,
    ip_confirmacion INET,
    email_enviado BOOLEAN NOT NULL DEFAULT FALSE,     -- correo de invitación/confirmación enviado
    email_enviado_at TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (cohorte_id, email_hash)
);
CREATE INDEX IF NOT EXISTS idx_panelistas_cohorte ON panelistas(cohorte_id);
CREATE INDEX IF NOT EXISTS idx_panelistas_token ON panelistas(token_confirmacion);

-- Qué panelista asiste a qué jornada (asistencia parcial).
CREATE TABLE IF NOT EXISTS panelista_jornadas (
    panelista_id UUID NOT NULL REFERENCES panelistas(id) ON DELETE CASCADE,
    jornada_id UUID NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
    PRIMARY KEY (panelista_id, jornada_id)
);

-- Logística por panelista (1:1). Transporte + comidas por fecha (JSONB con
-- clave = fecha ISO "YYYY-MM-DD" y valor booleano).
CREATE TABLE IF NOT EXISTS logistica_panelista (
    panelista_id UUID PRIMARY KEY REFERENCES panelistas(id) ON DELETE CASCADE,
    necesita_transporte BOOLEAN,               -- null = sin definir
    direccion_recogida TEXT,
    hora_recogida TIME,
    transporte_por_fecha JSONB NOT NULL DEFAULT '{}'::jsonb,
    almuerzo_por_fecha JSONB NOT NULL DEFAULT '{}'::jsonb,   -- viernes
    desayuno_por_fecha JSONB NOT NULL DEFAULT '{}'::jsonb,   -- sábados
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: todo el acceso pasa por el backend con service_role (que bypassa RLS).
-- Habilitamos RLS sin policies para negar acceso directo desde el cliente.
ALTER TABLE jornadas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE panelistas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE panelista_jornadas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistica_panelista ENABLE ROW LEVEL SECURITY;
