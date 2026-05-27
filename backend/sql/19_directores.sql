-- Directores: solo aplican a modalidades Caso y Proyecto de Investigacion.
-- Los profesores siguen siendo del MBA (Business Plan). Los directores son
-- una lista que admin administra; NO ingresan al sistema. Reciben emails
-- cuando un participante los elige + sube su anteproyecto.

CREATE TABLE IF NOT EXISTS directores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cedula_hash TEXT UNIQUE,                 -- opcional (mismo esquema que profesores)
    nombre_completo TEXT NOT NULL,
    email_encriptado TEXT NOT NULL,          -- AES-GCM (mismo crypto que email participantes)
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    areas_afinidad TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_directores_estado ON directores(estado);

ALTER TABLE directores ENABLE ROW LEVEL SECURITY;
-- (sin policies; default deny para anon — backend usa service_role)

-- Cada equipo de Caso/PI tiene UN director (inmutable una vez asignado).
ALTER TABLE equipos
  ADD COLUMN IF NOT EXISTS director_id UUID REFERENCES directores(id),
  ADD COLUMN IF NOT EXISTS director_asignado_at TIMESTAMPTZ;

-- Aprobacion del anteproyecto (la hace admin desde el panel; el director
-- solo es notificado por email, no tiene acceso al sistema). La aprobacion
-- desbloquea el upload del proyecto final.
ALTER TABLE anteproyectos
  ADD COLUMN IF NOT EXISTS anteproyecto_aprobado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anteproyecto_aprobado_por UUID;     -- profesor/admin id (sin FK estricto)

-- Trigger: una vez que el director esta asignado, no se puede cambiar.
CREATE OR REPLACE FUNCTION fn_lock_director_equipo() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.director_id IS NOT NULL
     AND NEW.director_id IS DISTINCT FROM OLD.director_id THEN
    RAISE EXCEPTION 'DIRECTOR_INMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_director_equipo ON equipos;
CREATE TRIGGER trg_lock_director_equipo
  BEFORE UPDATE ON equipos
  FOR EACH ROW EXECUTE FUNCTION fn_lock_director_equipo();
