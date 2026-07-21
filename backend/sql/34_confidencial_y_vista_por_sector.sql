-- =====================================================================
-- 34_confidencial_y_vista_por_sector.sql — Vista de trabajos por sector
--                                          (Comentario 13 QA, JMV 20-jul-2026)
--
-- La vista consolidada de trabajos de grado definitivos se organiza por SECTOR
-- (estructura tomada de navesfs.netlify.app, con la piel de naves-inalde.com) y
-- se protege con una clave. Además, cada proyecto puede marcarse CONFIDENCIAL:
-- en la vista aparece con 🔒 y SIN descargas ni one-pager.
--
-- Cambios ADITIVOS (nullable / con default): no afectan datos existentes.
-- =====================================================================

-- Proyecto confidencial: no expone descargas ni one-pager en la vista por sector.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS confidencial BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN proyectos.confidencial IS
    'Si es true, el proyecto se muestra en la vista de trabajos por sector marcado como Confidencial (🔒), sin descargas ni one-pager.';

-- Clave de acceso a la vista pública de trabajos por sector, por cohorte.
-- Se guarda HASHEADA (sha-256 hex, nunca en claro). NULL = vista cerrada.
ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS clave_vista_trabajos_hash TEXT;

COMMENT ON COLUMN cohortes.clave_vista_trabajos_hash IS
    'Hash sha-256 (hex) de la clave para acceder a la vista de trabajos por sector de esta cohorte. NULL = la vista está cerrada (nadie externo puede consultarla).';
