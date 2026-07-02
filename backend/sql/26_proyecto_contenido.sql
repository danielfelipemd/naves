-- =====================================================================
-- 26_proyecto_contenido.sql — Módulo C (Fase 2): Base de datos interna
-- Contenido de comunicaciones por proyecto (resumen, post LinkedIn, one
-- pager, logo). Lo consume la "Base de datos interna de proyectos" y lo
-- llenará el Módulo D (generación con IA) — por ahora se edita a mano o
-- queda vacío. La generación con IA guarda source_sha256 + aprobado para
-- el flujo de caché y revisión humana descrito en la doc técnica (§5).
-- =====================================================================

CREATE TABLE IF NOT EXISTS proyecto_contenido (
    proyecto_id UUID PRIMARY KEY REFERENCES proyectos(id) ON DELETE CASCADE,
    resumen TEXT,
    linkedin TEXT,
    one_pager_url TEXT,
    logo_url TEXT,
    source_sha256 VARCHAR(64),   -- hash de la fuente (one pager) para caché de IA
    generado_en TIMESTAMPTZ,     -- cuándo lo generó la IA
    aprobado BOOLEAN NOT NULL DEFAULT FALSE,  -- revisión humana (Módulo D)
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE proyecto_contenido ENABLE ROW LEVEL SECURITY;
