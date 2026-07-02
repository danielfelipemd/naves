-- =====================================================================
-- 27_notificaciones.sql — Módulo E (Fase 2): Notificaciones dentro de la
-- plataforma (campana en el header) + soporte de comunicaciones.
-- El destinatario se identifica por su auth_user_id (el `sub` del JWT), que
-- ya vive en participantes_lista.auth_user_id / profesores.auth_user_id.
-- =====================================================================

CREATE TABLE IF NOT EXISTS notificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    destinatario_auth_id UUID NOT NULL,     -- sub del JWT del destinatario
    tipo VARCHAR(40) NOT NULL,              -- 'presentacion_programada' | 'general' | ...
    titulo VARCHAR(160) NOT NULL,
    cuerpo TEXT,
    enlace VARCHAR(200),                    -- ruta interna, p.ej. '/mi-presentacion'
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    creada_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_dest ON notificaciones(destinatario_auth_id, leida);
CREATE INDEX IF NOT EXISTS idx_notif_creada ON notificaciones(creada_at);

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
