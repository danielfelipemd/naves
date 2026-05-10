-- =====================================================
-- NAVES INALDE — Modalidades de Trabajo de Grado
-- Añade 'caso' y 'proyecto_investigacion' al lado del Business Plan existente.
-- =====================================================

-- 1) Enum de modalidades
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_trabajo_grado') THEN
        CREATE TYPE tipo_trabajo_grado AS ENUM ('business_plan', 'caso', 'proyecto_investigacion');
    END IF;
END $$;

-- 2) Columnas en participantes_lista
ALTER TABLE participantes_lista
    ADD COLUMN IF NOT EXISTS tipo_trabajo_grado tipo_trabajo_grado NULL,
    ADD COLUMN IF NOT EXISTS tipo_trabajo_grado_fijado_at TIMESTAMPTZ NULL;

-- 3) Trigger de inmutabilidad: impide cambiar el tipo una vez fijado
CREATE OR REPLACE FUNCTION fn_lock_tipo_trabajo_grado()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.tipo_trabajo_grado IS NOT NULL
       AND NEW.tipo_trabajo_grado IS DISTINCT FROM OLD.tipo_trabajo_grado THEN
        RAISE EXCEPTION 'TIPO_TRABAJO_GRADO_INMUTABLE'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_tipo_trabajo_grado ON participantes_lista;
CREATE TRIGGER trg_lock_tipo_trabajo_grado
    BEFORE UPDATE ON participantes_lista
    FOR EACH ROW EXECUTE FUNCTION fn_lock_tipo_trabajo_grado();

-- 4) Columna en equipos (NULL inicial; se vuelve NOT NULL tras migrar data legacy)
ALTER TABLE equipos
    ADD COLUMN IF NOT EXISTS tipo_trabajo_grado tipo_trabajo_grado NULL;

-- 5) Migración de data legacy
--    Todo equipo y participante ya activo en un equipo queda como 'business_plan'.
UPDATE equipos
    SET tipo_trabajo_grado = 'business_plan'
    WHERE tipo_trabajo_grado IS NULL;

UPDATE participantes_lista
    SET tipo_trabajo_grado = 'business_plan',
        tipo_trabajo_grado_fijado_at = NOW()
    WHERE tipo_trabajo_grado IS NULL
      AND id IN (SELECT participante_id FROM miembros_equipo);

ALTER TABLE equipos ALTER COLUMN tipo_trabajo_grado SET NOT NULL;

-- 6) Columnas de archivos en anteproyectos (NULL para business_plan;
--    los rellenan los flujos de caso/proyecto_investigacion)
ALTER TABLE anteproyectos
    ADD COLUMN IF NOT EXISTS archivo_anteproyecto_path TEXT NULL,
    ADD COLUMN IF NOT EXISTS archivo_anteproyecto_mime TEXT NULL,
    ADD COLUMN IF NOT EXISTS archivo_anteproyecto_size_bytes INTEGER NULL,
    ADD COLUMN IF NOT EXISTS archivo_anteproyecto_uploaded_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS archivo_proyecto_final_path TEXT NULL,
    ADD COLUMN IF NOT EXISTS archivo_proyecto_final_mime TEXT NULL,
    ADD COLUMN IF NOT EXISTS archivo_proyecto_final_size_bytes INTEGER NULL,
    ADD COLUMN IF NOT EXISTS archivo_proyecto_final_uploaded_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN participantes_lista.tipo_trabajo_grado IS
    'Modalidad de trabajo de grado. Se fija una vez con click del participante. Inmutable (trigger trg_lock_tipo_trabajo_grado).';
COMMENT ON COLUMN equipos.tipo_trabajo_grado IS
    'Copiada del creador al crear el equipo. Todos los miembros deben tener la misma. Inmutable.';

-- 7) Bucket privado de Supabase Storage para los archivos
--    Idempotente: solo crea si no existe.
INSERT INTO storage.buckets (id, name, public)
    VALUES ('trabajos-grado', 'trabajos-grado', false)
    ON CONFLICT (id) DO NOTHING;
