-- =====================================================
-- NAVES — Sistema RBAC granular (roles + permisos)
-- Coexiste con el modelo simple (es_super_admin) para
-- backward compat. Las funciones nuevas chequean permisos.
-- =====================================================

-- ===== Catálogo de permisos atómicos =================
CREATE TABLE permisos (
    code VARCHAR(60) PRIMARY KEY,
    descripcion TEXT NOT NULL,
    categoria VARCHAR(40) NOT NULL,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO permisos (code, descripcion, categoria) VALUES
    -- Cohortes
    ('cohortes.ver',          'Ver lista y fechas de cohortes',                 'cohortes'),
    ('cohortes.editar',       'Editar fechas Scheduler de cohortes',            'cohortes'),
    -- Participantes
    ('participantes.ver',     'Ver lista de participantes',                     'participantes'),
    ('participantes.cargar',  'Cargar Excel con lista de participantes',        'participantes'),
    -- Profesores
    ('profesores.ver',        'Ver lista de profesores',                        'profesores'),
    ('profesores.crear',      'Crear nuevos profesores',                        'profesores'),
    ('profesores.editar',     'Editar profesores existentes',                   'profesores'),
    -- Anteproyectos
    ('anteproyectos.ver_todos',     'Ver todos los anteproyectos del sistema',  'anteproyectos'),
    ('anteproyectos.descargar_pdf', 'Descargar PDF de anteproyectos',           'anteproyectos'),
    -- Sábana
    ('sabana.ver',       'Ver sábana de proyectos consolidada',                 'sabana'),
    ('sabana.generar',   'Generar/regenerar sábana',                            'sabana'),
    ('sabana.asignar',   'Asignar profesores a equipos',                        'sabana'),
    ('sabana.comunicar', 'Disparar comunicación a equipos',                     'sabana'),
    -- Solicitudes
    ('solicitudes.ver',      'Ver solicitudes de desarchivado',                 'solicitudes'),
    ('solicitudes.resolver', 'Aprobar/rechazar solicitudes',                    'solicitudes'),
    -- Auditoría
    ('auditoria.ver',        'Ver registro de auditoría',                       'auditoria'),
    -- Meta (gestión del sistema)
    ('roles.gestionar',      'Crear/editar roles y permisos',                   'meta'),
    -- Participante (para roles que también son estudiantes)
    ('participante.equipo',          'Crear y gestionar su propio equipo',          'participante'),
    ('participante.anteproyecto',    'Editar y enviar su anteproyecto',             'participante'),
    ('participante.seleccion',       'Marcar Reunión 1 y elegir definitivo',        'participante'),
    ('participante.solicitar_desarchivar', 'Solicitar desarchivar proyecto suyo',  'participante')
ON CONFLICT DO NOTHING;

-- ===== Roles =========================================
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(60) UNIQUE NOT NULL,
    descripcion TEXT,
    es_sistema BOOLEAN DEFAULT FALSE,                    -- los 3 base no se borran
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (nombre, descripcion, es_sistema) VALUES
    ('super_admin',  'Acceso completo al sistema (no se puede eliminar)',     TRUE),
    ('profesor',     'Profesor regular del MBA',                              TRUE),
    ('participante', 'Estudiante del MBA',                                    TRUE)
ON CONFLICT (nombre) DO NOTHING;

-- ===== Asignación permisos a roles ===================
CREATE TABLE rol_permisos (
    rol_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permiso_code VARCHAR(60) NOT NULL REFERENCES permisos(code) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_code)
);

-- super_admin: todos los permisos del sistema (no los del participante)
INSERT INTO rol_permisos (rol_id, permiso_code)
SELECT r.id, p.code
FROM roles r CROSS JOIN permisos p
WHERE r.nombre = 'super_admin' AND p.categoria != 'participante'
ON CONFLICT DO NOTHING;

-- profesor: lectura + sábana + solicitudes
INSERT INTO rol_permisos (rol_id, permiso_code)
SELECT r.id, p.code
FROM roles r, permisos p
WHERE r.nombre = 'profesor'
  AND p.code IN (
      'cohortes.ver',
      'anteproyectos.ver_todos',
      'anteproyectos.descargar_pdf',
      'sabana.ver',
      'solicitudes.ver',
      'solicitudes.resolver'
  )
ON CONFLICT DO NOTHING;

-- participante: sus propios permisos
INSERT INTO rol_permisos (rol_id, permiso_code)
SELECT r.id, p.code
FROM roles r, permisos p
WHERE r.nombre = 'participante' AND p.categoria = 'participante'
ON CONFLICT DO NOTHING;

-- ===== Asignación de roles a usuarios (múltiples) ====
CREATE TABLE usuario_roles (
    auth_user_id UUID NOT NULL,
    rol_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    asignado_por UUID,
    fecha_asignacion TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (auth_user_id, rol_id)
);

CREATE INDEX idx_usuario_roles_user ON usuario_roles(auth_user_id);

-- ===== Permisos directos a un usuario (override) =====
CREATE TABLE usuario_permisos (
    auth_user_id UUID NOT NULL,
    permiso_code VARCHAR(60) NOT NULL REFERENCES permisos(code) ON DELETE CASCADE,
    asignado_por UUID,
    fecha_asignacion TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (auth_user_id, permiso_code)
);

CREATE INDEX idx_usuario_permisos_user ON usuario_permisos(auth_user_id);

-- ===== Migración: usuarios existentes → nuevos roles =
-- Profesores con es_super_admin → super_admin
INSERT INTO usuario_roles (auth_user_id, rol_id)
SELECT p.auth_user_id, (SELECT id FROM roles WHERE nombre = 'super_admin')
FROM profesores p
WHERE p.es_super_admin = TRUE AND p.auth_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Profesores regulares → profesor
INSERT INTO usuario_roles (auth_user_id, rol_id)
SELECT p.auth_user_id, (SELECT id FROM roles WHERE nombre = 'profesor')
FROM profesores p
WHERE p.es_super_admin = FALSE AND p.auth_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Participantes → participante
INSERT INTO usuario_roles (auth_user_id, rol_id)
SELECT pl.auth_user_id, (SELECT id FROM roles WHERE nombre = 'participante')
FROM participantes_lista pl
WHERE pl.auth_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ===== Helpers de Postgres ===========================
CREATE OR REPLACE FUNCTION auth.tiene_permiso(p_code TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        -- Permiso directo
        SELECT 1 FROM usuario_permisos
        WHERE auth_user_id = auth.uid() AND permiso_code = p_code
        UNION
        -- Permiso vía rol
        SELECT 1 FROM usuario_roles ur
        JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
        WHERE ur.auth_user_id = auth.uid() AND rp.permiso_code = p_code
    )
$$;

CREATE OR REPLACE FUNCTION auth.permisos_del_usuario(p_user UUID)
RETURNS TABLE(permiso_code VARCHAR) LANGUAGE SQL STABLE AS $$
    SELECT permiso_code FROM usuario_permisos WHERE auth_user_id = p_user
    UNION
    SELECT rp.permiso_code FROM usuario_roles ur
    JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
    WHERE ur.auth_user_id = p_user
$$;

-- Wrapper en public para que supabase-js .rpc('permisos_del_usuario') lo encuentre
CREATE OR REPLACE FUNCTION public.permisos_del_usuario(p_user UUID)
RETURNS TABLE(permiso_code VARCHAR) LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT permiso_code FROM usuario_permisos WHERE auth_user_id = p_user
    UNION
    SELECT rp.permiso_code FROM usuario_roles ur
    JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
    WHERE ur.auth_user_id = p_user
$$;
GRANT EXECUTE ON FUNCTION public.permisos_del_usuario(UUID) TO anon, authenticated, service_role;

-- ===== RLS sobre las nuevas tablas ===================
ALTER TABLE permisos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rol_permisos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_permisos  ENABLE ROW LEVEL SECURITY;

-- Lectura pública (autenticados)
CREATE POLICY p_permisos_read ON permisos FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY p_roles_read    ON roles    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY p_rol_perm_read ON rol_permisos FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY p_user_roles_read ON usuario_roles FOR SELECT
    USING (auth_user_id = auth.uid() OR auth.tiene_permiso('roles.gestionar'));
CREATE POLICY p_user_perm_read  ON usuario_permisos FOR SELECT
    USING (auth_user_id = auth.uid() OR auth.tiene_permiso('roles.gestionar'));

-- Escritura: solo quien tenga roles.gestionar
CREATE POLICY p_roles_admin ON roles FOR ALL
    USING (auth.tiene_permiso('roles.gestionar'))
    WITH CHECK (auth.tiene_permiso('roles.gestionar'));
CREATE POLICY p_rol_perm_admin ON rol_permisos FOR ALL
    USING (auth.tiene_permiso('roles.gestionar'))
    WITH CHECK (auth.tiene_permiso('roles.gestionar'));
CREATE POLICY p_user_roles_admin ON usuario_roles FOR ALL
    USING (auth.tiene_permiso('roles.gestionar'))
    WITH CHECK (auth.tiene_permiso('roles.gestionar'));
CREATE POLICY p_user_perm_admin ON usuario_permisos FOR ALL
    USING (auth.tiene_permiso('roles.gestionar'))
    WITH CHECK (auth.tiene_permiso('roles.gestionar'));
