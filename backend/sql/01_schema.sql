-- =====================================================
-- NAVES INALDE — Schema base
-- Postgres 15+ / Supabase
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================
-- AUTH HELPERS — leen claims del JWT de Supabase Auth
-- =====================================================

CREATE OR REPLACE FUNCTION auth.app_role()
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'app_role'),
    (auth.jwt() ->> 'app_role')
  )
$$;

CREATE OR REPLACE FUNCTION auth.participante_id()
RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'participante_id','')::UUID
$$;

CREATE OR REPLACE FUNCTION auth.profesor_id()
RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'profesor_id','')::UUID
$$;

CREATE OR REPLACE FUNCTION auth.es_super_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'es_super_admin')::BOOLEAN, FALSE)
$$;

-- =====================================================
-- COHORTES
-- =====================================================
CREATE TABLE cohortes (
    id VARCHAR(20) PRIMARY KEY,
    etiqueta VARCHAR(50) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    fecha_limite_formacion_equipos TIMESTAMPTZ,
    fecha_limite_entrega_anteproyecto TIMESTAMPTZ,
    fecha_reunion_1 TIMESTAMPTZ,
    fecha_limite_seleccion_definitivo TIMESTAMPTZ,
    activa BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- CIIU (catálogo DANE Rev 4 A.C. 2020)
-- =====================================================
CREATE TABLE codigos_ciiu (
    codigo VARCHAR(4) PRIMARY KEY,
    descripcion VARCHAR(500) NOT NULL,
    seccion CHAR(1) NOT NULL,
    division VARCHAR(2) NOT NULL,
    grupo VARCHAR(3) NOT NULL,
    activo BOOLEAN DEFAULT TRUE
);
CREATE INDEX idx_ciiu_descripcion ON codigos_ciiu USING gin(to_tsvector('spanish', descripcion));
CREATE INDEX idx_ciiu_seccion ON codigos_ciiu(seccion);

-- =====================================================
-- PROFESORES
-- =====================================================
CREATE TABLE profesores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE,
    nombre_completo VARCHAR(150) NOT NULL,
    email_encriptado TEXT NOT NULL,
    email_hash VARCHAR(64) NOT NULL UNIQUE,
    es_super_admin BOOLEAN DEFAULT FALSE,
    activo BOOLEAN DEFAULT TRUE,
    booking_url TEXT,
    areas_afinidad TEXT[] DEFAULT '{}',
    ultimo_login TIMESTAMPTZ,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_profesores_auth ON profesores(auth_user_id);

-- =====================================================
-- PARTICIPANTES (lista pre-cargada)
-- =====================================================
CREATE TABLE participantes_lista (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id),
    auth_user_id UUID UNIQUE,
    nombre_completo VARCHAR(150) NOT NULL,
    cedula_encriptada TEXT NOT NULL,
    cedula_hash VARCHAR(64) NOT NULL,
    email_encriptado TEXT NOT NULL,
    email_hash VARCHAR(64) NOT NULL,
    celular_encriptado TEXT,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_activacion',
    fecha_activacion TIMESTAMPTZ,
    ultimo_login TIMESTAMPTZ,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cohorte_id, cedula_hash),
    UNIQUE(cohorte_id, email_hash),
    CHECK (estado IN ('pendiente_activacion','activo','desactivado'))
);
CREATE INDEX idx_part_lista_cedula_hash ON participantes_lista(cedula_hash);
CREATE INDEX idx_part_lista_estado ON participantes_lista(estado);
CREATE INDEX idx_part_lista_cohorte ON participantes_lista(cohorte_id);
CREATE INDEX idx_part_lista_auth ON participantes_lista(auth_user_id);

-- =====================================================
-- EQUIPOS
-- =====================================================
CREATE TABLE equipos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id),
    creador_id UUID NOT NULL REFERENCES participantes_lista(id),
    nombre_equipo VARCHAR(100),
    reunion_1_marcada_por UUID REFERENCES participantes_lista(id),
    reunion_1_fecha_marcado TIMESTAMPTZ,
    proyecto_definitivo_id UUID,
    fecha_seleccion_definitivo TIMESTAMPTZ,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_equipos_cohorte ON equipos(cohorte_id);

-- =====================================================
-- MIEMBROS EQUIPO
-- =====================================================
CREATE TABLE miembros_equipo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id UUID NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    participante_id UUID NOT NULL REFERENCES participantes_lista(id),
    posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 3),
    fue_emprendedor BOOLEAN,
    quiebra VARCHAR(10) CHECK (quiebra IN ('si','no','na')),
    aprendizajes_quiebra TEXT,
    perfil VARCHAR(20) CHECK (perfil IN ('emprendedor','directivo','ambos')),
    fecha_union TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(equipo_id, posicion),
    UNIQUE(equipo_id, participante_id),
    UNIQUE(participante_id)
);

-- =====================================================
-- EMOCIONES y PREOCUPACIONES (selección múltiple)
-- =====================================================
CREATE TABLE miembro_emociones (
    miembro_id UUID NOT NULL REFERENCES miembros_equipo(id) ON DELETE CASCADE,
    emocion VARCHAR(20) NOT NULL CHECK (emocion IN ('crear','dinero','problema','autonomia')),
    PRIMARY KEY (miembro_id, emocion)
);

CREATE TABLE miembro_preocupaciones (
    miembro_id UUID NOT NULL REFERENCES miembros_equipo(id) ON DELETE CASCADE,
    preocupacion VARCHAR(20) NOT NULL CHECK (preocupacion IN ('financiera','estres','habilidades','familia')),
    PRIMARY KEY (miembro_id, preocupacion)
);

-- =====================================================
-- ANTEPROYECTOS
-- =====================================================
CREATE TABLE anteproyectos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id UUID NOT NULL UNIQUE REFERENCES equipos(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador','enviado','revisado','aprobado')),
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_envio TIMESTAMPTZ,
    fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
    ultimo_editor_id UUID REFERENCES participantes_lista(id)
);

-- =====================================================
-- PROYECTOS (1-3 por anteproyecto)
-- =====================================================
CREATE TABLE proyectos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anteproyecto_id UUID NOT NULL REFERENCES anteproyectos(id) ON DELETE CASCADE,
    posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 3),
    estado_seleccion VARCHAR(20) NOT NULL DEFAULT 'pendiente_seleccion'
        CHECK (estado_seleccion IN ('pendiente_seleccion','definitivo','archivado')),
    fecha_archivado TIMESTAMPTZ,
    desarchivado BOOLEAN DEFAULT FALSE,
    fecha_desarchivado TIMESTAMPTZ,
    desarchivado_aprobado_por UUID REFERENCES profesores(id),
    nombre VARCHAR(150) NOT NULL,
    tipo VARCHAR(30) CHECK (tipo IN ('emprendimiento','intraemprendimiento')),
    sector VARCHAR(100),
    ciiu VARCHAR(4) REFERENCES codigos_ciiu(codigo),
    canvas_cliente_problema TEXT,
    canvas_canales TEXT,
    canvas_relaciones TEXT,
    canvas_ingresos TEXT,
    canvas_recursos TEXT,
    canvas_actividades TEXT,
    canvas_socios TEXT,
    canvas_costos TEXT,
    estado VARCHAR(20) CHECK (estado IN ('idea','investigacion','prototipo','validacion')),
    fuentes_primarias TEXT,
    fuentes_secundarias TEXT,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(anteproyecto_id, posicion)
);
CREATE INDEX idx_proyectos_anteproyecto ON proyectos(anteproyecto_id);
CREATE INDEX idx_proyectos_estado_seleccion ON proyectos(estado_seleccion);

-- FK circular para proyecto definitivo
ALTER TABLE equipos ADD CONSTRAINT fk_proyecto_definitivo
    FOREIGN KEY (proyecto_definitivo_id) REFERENCES proyectos(id);

-- =====================================================
-- HITOS (cronograma)
-- =====================================================
CREATE TABLE hitos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    posicion INTEGER NOT NULL,
    descripcion VARCHAR(200) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    CHECK (fecha_fin >= fecha_inicio),
    UNIQUE(proyecto_id, posicion)
);

-- =====================================================
-- SOLICITUDES DESARCHIVADO
-- =====================================================
CREATE TABLE solicitudes_desarchivado (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proyecto_id UUID NOT NULL REFERENCES proyectos(id),
    solicitante_id UUID NOT NULL REFERENCES participantes_lista(id),
    motivo TEXT NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente','aprobada','rechazada')),
    profesor_id UUID REFERENCES profesores(id),
    respuesta_profesor TEXT,
    fecha_solicitud TIMESTAMPTZ DEFAULT NOW(),
    fecha_respuesta TIMESTAMPTZ
);

-- =====================================================
-- SÁBANA + ASIGNACIÓN PROFESORES
-- =====================================================
CREATE TABLE sabanas_proyectos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohorte_id VARCHAR(20) NOT NULL UNIQUE REFERENCES cohortes(id),
    estado VARCHAR(20) DEFAULT 'generada'
        CHECK (estado IN ('generada','en_revision','asignada','comunicada')),
    fecha_generacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_asignacion_completa TIMESTAMPTZ,
    fecha_comunicacion TIMESTAMPTZ,
    snapshot JSONB,
    sugerencias JSONB
);

CREATE TABLE asignaciones_profesor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id UUID NOT NULL UNIQUE REFERENCES equipos(id),
    profesor_id UUID NOT NULL REFERENCES profesores(id),
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id),
    asignado_por UUID NOT NULL REFERENCES profesores(id),
    fecha_asignacion TIMESTAMPTZ DEFAULT NOW(),
    notificacion_enviada BOOLEAN DEFAULT FALSE,
    fecha_notificacion TIMESTAMPTZ
);
CREATE INDEX idx_asign_profesor ON asignaciones_profesor(profesor_id);
CREATE INDEX idx_asign_cohorte ON asignaciones_profesor(cohorte_id);

-- =====================================================
-- HISTORIAL CAMBIOS DE EQUIPO
-- =====================================================
CREATE TABLE historial_equipos (
    id BIGSERIAL PRIMARY KEY,
    participante_id UUID NOT NULL REFERENCES participantes_lista(id),
    equipo_anterior_id UUID REFERENCES equipos(id),
    equipo_nuevo_id UUID REFERENCES equipos(id),
    fecha_cambio TIMESTAMPTZ DEFAULT NOW(),
    motivo TEXT
);

-- =====================================================
-- TOKENS DE RECUPERACIÓN DE CLAVE (custom flow)
-- =====================================================
CREATE TABLE recovery_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participante_id UUID REFERENCES participantes_lista(id) ON DELETE CASCADE,
    profesor_id UUID REFERENCES profesores(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expira_en TIMESTAMPTZ NOT NULL,
    usado BOOLEAN DEFAULT FALSE,
    fecha_uso TIMESTAMPTZ,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    CHECK ((participante_id IS NOT NULL) OR (profesor_id IS NOT NULL))
);
CREATE INDEX idx_recovery_token_hash ON recovery_tokens(token_hash);
CREATE INDEX idx_recovery_expira ON recovery_tokens(expira_en);

-- =====================================================
-- AUDITORÍA
-- =====================================================
CREATE TABLE auditoria (
    id BIGSERIAL PRIMARY KEY,
    actor_tipo VARCHAR(20) NOT NULL CHECK (actor_tipo IN ('participante','profesor','super_admin','sistema','anonimo')),
    actor_id UUID,
    accion VARCHAR(80) NOT NULL,
    entidad_tipo VARCHAR(50),
    entidad_id UUID,
    detalles JSONB,
    ip INET,
    user_agent TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_auditoria_actor ON auditoria(actor_id, timestamp DESC);
CREATE INDEX idx_auditoria_entidad ON auditoria(entidad_tipo, entidad_id);
CREATE INDEX idx_auditoria_accion ON auditoria(accion, timestamp DESC);

-- =====================================================
-- TRIGGER fecha_actualizacion
-- =====================================================
CREATE OR REPLACE FUNCTION trg_set_updated() RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_actualizacion := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_equipos_updated BEFORE UPDATE ON equipos
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated();
CREATE TRIGGER trg_anteproyectos_updated BEFORE UPDATE ON anteproyectos
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated();
