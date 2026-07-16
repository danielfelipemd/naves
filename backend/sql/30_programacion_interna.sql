-- =====================================================
-- NAVES — Programación Interna (Fase 2)
-- Vista de solo lectura de la escaleta del evento para las áreas que se
-- alimentan de ella: marketing, operaciones y asistente de programa.
--
-- Se distingue de la "programación de panelistas", que es pública, sin login y
-- con formulario de confirmación. Esta es interna y exige rol.
-- =====================================================

-- ===== Permiso ========================================
INSERT INTO permisos (code, descripcion, categoria) VALUES
    ('programacion_interna.ver', 'Ver y descargar la programación interna del evento', 'programacion')
ON CONFLICT DO NOTHING;

-- El super_admin tiene todos los permisos que no son del participante, pero esa
-- asignación (06_roles_permisos) fue un INSERT ... SELECT de una sola vez: los
-- permisos creados después NO le llegan solos. Hay que dárselo explícitamente o
-- el admin no podría abrir la pantalla que él mismo publica.
INSERT INTO rol_permisos (rol_id, permiso_code)
SELECT r.id, 'programacion_interna.ver'
FROM roles r WHERE r.nombre = 'super_admin'
ON CONFLICT DO NOTHING;

-- ===== Roles de área ==================================
-- es_sistema = TRUE: son parte del modelo del evento, no roles ad hoc que el
-- admin deba poder borrar desde la pantalla de Roles y permisos.
INSERT INTO roles (nombre, descripcion, es_sistema) VALUES
    ('marketing',          'Marketing — consulta la programación interna del evento',            TRUE),
    ('operaciones',        'Operaciones — consulta la programación interna del evento',          TRUE),
    ('asistente_programa', 'Asistente de programa — consulta la programación interna del evento', TRUE)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_code)
SELECT r.id, 'programacion_interna.ver'
FROM roles r
WHERE r.nombre IN ('marketing', 'operaciones', 'asistente_programa')
ON CONFLICT DO NOTHING;

-- ===== Staff de área en la tabla profesores ===========
-- `profesores` es, de hecho, la tabla de "personal con login por correo": tiene
-- alta desde el panel, recuperación de clave y el flag activo. Las personas de
-- área cuelgan de ahí en vez de duplicar toda esa infraestructura.
--
-- El riesgo es que la sábana ofrece TODO profesor activo como director asignable
-- (sabana.ts), así que sin distinguirlos la gente de marketing aparecería como
-- candidata a dirigir trabajos de grado. `tipo` es esa frontera.
ALTER TABLE profesores ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'profesor';

ALTER TABLE profesores DROP CONSTRAINT IF EXISTS profesores_tipo_check;
ALTER TABLE profesores ADD CONSTRAINT profesores_tipo_check CHECK (tipo IN ('profesor', 'area'));

COMMENT ON COLUMN profesores.tipo IS
    'profesor = docente asignable como director en la sábana. area = staff interno (marketing, operaciones, asistente de programa): entra al sistema pero NO dirige trabajos de grado.';

CREATE INDEX IF NOT EXISTS idx_profesores_tipo ON profesores(tipo);
