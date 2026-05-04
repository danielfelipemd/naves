-- =====================================================
-- NAVES — Row Level Security
-- Aplica reglas de acceso a nivel de fila usando los
-- helpers auth.app_role(), auth.participante_id(), etc.
-- =====================================================

-- Habilitar RLS en todas las tablas relevantes
ALTER TABLE cohortes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE codigos_ciiu              ENABLE ROW LEVEL SECURITY;
ALTER TABLE profesores                ENABLE ROW LEVEL SECURITY;
ALTER TABLE participantes_lista       ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipos                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembros_equipo           ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembro_emociones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembro_preocupaciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE anteproyectos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitos                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_desarchivado  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sabanas_proyectos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE asignaciones_profesor     ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_equipos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria                 ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- COHORTES — lectura pública para usuarios autenticados,
-- escritura solo super admin
-- =====================================================
CREATE POLICY p_cohortes_select ON cohortes FOR SELECT
    USING (auth.app_role() IS NOT NULL);
CREATE POLICY p_cohortes_admin  ON cohortes FOR ALL
    USING (auth.es_super_admin())
    WITH CHECK (auth.es_super_admin());

-- =====================================================
-- CIIU — lectura pública (autenticados), carga solo super admin
-- =====================================================
CREATE POLICY p_ciiu_select ON codigos_ciiu FOR SELECT
    USING (auth.app_role() IS NOT NULL);
CREATE POLICY p_ciiu_admin  ON codigos_ciiu FOR ALL
    USING (auth.es_super_admin())
    WITH CHECK (auth.es_super_admin());

-- =====================================================
-- PROFESORES
-- =====================================================
CREATE POLICY p_profesores_self ON profesores FOR SELECT
    USING (
        auth.app_role() IN ('profesor','super_admin')
        OR id = auth.profesor_id()
    );
CREATE POLICY p_profesores_admin ON profesores FOR ALL
    USING (auth.es_super_admin())
    WITH CHECK (auth.es_super_admin());

-- =====================================================
-- PARTICIPANTES_LISTA
-- Lectura: el propio participante o staff
-- Escritura: solo super admin (carga via Excel)
-- =====================================================
CREATE POLICY p_participantes_self ON participantes_lista FOR SELECT
    USING (
        id = auth.participante_id()
        OR auth.app_role() IN ('profesor','super_admin')
    );
CREATE POLICY p_participantes_admin ON participantes_lista FOR ALL
    USING (auth.es_super_admin())
    WITH CHECK (auth.es_super_admin());

-- =====================================================
-- EQUIPOS
-- Lectura: miembros del equipo + staff
-- Escritura: miembros del equipo dentro de plazo
-- =====================================================
CREATE OR REPLACE FUNCTION auth.es_miembro_equipo(p_equipo_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM miembros_equipo
        WHERE equipo_id = p_equipo_id
          AND participante_id = auth.participante_id()
    )
$$;

CREATE OR REPLACE FUNCTION auth.dentro_plazo_formacion(p_equipo_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT NOW() < c.fecha_limite_formacion_equipos
    FROM equipos e JOIN cohortes c ON c.id = e.cohorte_id
    WHERE e.id = p_equipo_id
$$;

CREATE OR REPLACE FUNCTION auth.dentro_plazo_anteproyecto(p_equipo_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT NOW() < c.fecha_limite_entrega_anteproyecto
    FROM equipos e JOIN cohortes c ON c.id = e.cohorte_id
    WHERE e.id = p_equipo_id
$$;

CREATE POLICY p_equipos_select ON equipos FOR SELECT
    USING (
        auth.es_miembro_equipo(id)
        OR auth.app_role() IN ('profesor','super_admin')
    );

CREATE POLICY p_equipos_insert ON equipos FOR INSERT
    WITH CHECK (
        auth.app_role() = 'participante'
        AND creador_id = auth.participante_id()
    );

CREATE POLICY p_equipos_update ON equipos FOR UPDATE
    USING (
        (auth.es_miembro_equipo(id) AND auth.dentro_plazo_formacion(id))
        OR auth.es_super_admin()
    );

-- =====================================================
-- MIEMBROS EQUIPO
-- =====================================================
CREATE POLICY p_miembros_select ON miembros_equipo FOR SELECT
    USING (
        auth.es_miembro_equipo(equipo_id)
        OR auth.app_role() IN ('profesor','super_admin')
    );

CREATE POLICY p_miembros_modify ON miembros_equipo FOR ALL
    USING (
        (auth.es_miembro_equipo(equipo_id) AND auth.dentro_plazo_formacion(equipo_id))
        OR auth.es_super_admin()
    )
    WITH CHECK (
        (auth.es_miembro_equipo(equipo_id) AND auth.dentro_plazo_formacion(equipo_id))
        OR auth.es_super_admin()
    );

-- emociones / preocupaciones siguen las mismas reglas que su miembro
CREATE POLICY p_emociones_all ON miembro_emociones FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM miembros_equipo m
            WHERE m.id = miembro_emociones.miembro_id
              AND (auth.es_miembro_equipo(m.equipo_id) OR auth.app_role() IN ('profesor','super_admin'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM miembros_equipo m
            WHERE m.id = miembro_emociones.miembro_id
              AND auth.es_miembro_equipo(m.equipo_id)
              AND auth.dentro_plazo_anteproyecto(m.equipo_id)
        )
        OR auth.es_super_admin()
    );

CREATE POLICY p_preocupaciones_all ON miembro_preocupaciones FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM miembros_equipo m
            WHERE m.id = miembro_preocupaciones.miembro_id
              AND (auth.es_miembro_equipo(m.equipo_id) OR auth.app_role() IN ('profesor','super_admin'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM miembros_equipo m
            WHERE m.id = miembro_preocupaciones.miembro_id
              AND auth.es_miembro_equipo(m.equipo_id)
              AND auth.dentro_plazo_anteproyecto(m.equipo_id)
        )
        OR auth.es_super_admin()
    );

-- =====================================================
-- ANTEPROYECTOS
-- =====================================================
CREATE POLICY p_anteproyectos_select ON anteproyectos FOR SELECT
    USING (
        auth.es_miembro_equipo(equipo_id)
        OR auth.app_role() IN ('profesor','super_admin')
    );

CREATE POLICY p_anteproyectos_insert ON anteproyectos FOR INSERT
    WITH CHECK (auth.es_miembro_equipo(equipo_id));

CREATE POLICY p_anteproyectos_update ON anteproyectos FOR UPDATE
    USING (
        (auth.es_miembro_equipo(equipo_id) AND auth.dentro_plazo_anteproyecto(equipo_id))
        OR auth.es_super_admin()
    );

-- =====================================================
-- PROYECTOS — bloqueo si está congelado
-- =====================================================
CREATE OR REPLACE FUNCTION auth.proyecto_editable(p_proyecto_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT estado_seleccion NOT IN ('definitivo','archivado')
    FROM proyectos WHERE id = p_proyecto_id
$$;

CREATE POLICY p_proyectos_select ON proyectos FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM anteproyectos a
            WHERE a.id = proyectos.anteproyecto_id
              AND (auth.es_miembro_equipo(a.equipo_id) OR auth.app_role() IN ('profesor','super_admin'))
        )
    );

CREATE POLICY p_proyectos_insert ON proyectos FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM anteproyectos a
            WHERE a.id = anteproyecto_id
              AND auth.es_miembro_equipo(a.equipo_id)
              AND auth.dentro_plazo_anteproyecto(a.equipo_id)
        )
    );

CREATE POLICY p_proyectos_update ON proyectos FOR UPDATE
    USING (
        (
            auth.proyecto_editable(id)
            AND EXISTS (
                SELECT 1 FROM anteproyectos a
                WHERE a.id = anteproyecto_id
                  AND auth.es_miembro_equipo(a.equipo_id)
                  AND auth.dentro_plazo_anteproyecto(a.equipo_id)
            )
        )
        OR auth.es_super_admin()
    );

-- =====================================================
-- HITOS — siguen al proyecto
-- =====================================================
CREATE POLICY p_hitos_select ON hitos FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM proyectos p
            JOIN anteproyectos a ON a.id = p.anteproyecto_id
            WHERE p.id = hitos.proyecto_id
              AND (auth.es_miembro_equipo(a.equipo_id) OR auth.app_role() IN ('profesor','super_admin'))
        )
    );

CREATE POLICY p_hitos_modify ON hitos FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM proyectos p
            JOIN anteproyectos a ON a.id = p.anteproyecto_id
            WHERE p.id = hitos.proyecto_id
              AND auth.es_miembro_equipo(a.equipo_id)
              AND auth.proyecto_editable(p.id)
              AND auth.dentro_plazo_anteproyecto(a.equipo_id)
        )
        OR auth.es_super_admin()
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM proyectos p
            JOIN anteproyectos a ON a.id = p.anteproyecto_id
            WHERE p.id = hitos.proyecto_id
              AND auth.es_miembro_equipo(a.equipo_id)
              AND auth.proyecto_editable(p.id)
              AND auth.dentro_plazo_anteproyecto(a.equipo_id)
        )
        OR auth.es_super_admin()
    );

-- =====================================================
-- SOLICITUDES DESARCHIVADO
-- =====================================================
CREATE POLICY p_solicitudes_select ON solicitudes_desarchivado FOR SELECT
    USING (
        solicitante_id = auth.participante_id()
        OR auth.app_role() IN ('profesor','super_admin')
    );

CREATE POLICY p_solicitudes_insert ON solicitudes_desarchivado FOR INSERT
    WITH CHECK (
        auth.app_role() = 'participante'
        AND solicitante_id = auth.participante_id()
    );

CREATE POLICY p_solicitudes_resolver ON solicitudes_desarchivado FOR UPDATE
    USING (auth.app_role() IN ('profesor','super_admin'));

-- =====================================================
-- SÁBANA + ASIGNACIONES
-- =====================================================
CREATE POLICY p_sabana_select ON sabanas_proyectos FOR SELECT
    USING (auth.app_role() IN ('profesor','super_admin'));
CREATE POLICY p_sabana_admin  ON sabanas_proyectos FOR ALL
    USING (auth.es_super_admin())
    WITH CHECK (auth.es_super_admin());

CREATE POLICY p_asignaciones_select ON asignaciones_profesor FOR SELECT
    USING (
        profesor_id = auth.profesor_id()
        OR auth.es_super_admin()
        OR auth.es_miembro_equipo(equipo_id)  -- participantes ven a su profesor asignado
    );
CREATE POLICY p_asignaciones_admin ON asignaciones_profesor FOR ALL
    USING (auth.es_super_admin())
    WITH CHECK (auth.es_super_admin());

-- =====================================================
-- HISTORIAL EQUIPOS / RECOVERY TOKENS / AUDITORÍA
-- Solo backend (Service Role bypasea RLS) escribe estos
-- =====================================================
CREATE POLICY p_historial_super ON historial_equipos FOR SELECT
    USING (auth.es_super_admin() OR participante_id = auth.participante_id());

CREATE POLICY p_recovery_super ON recovery_tokens FOR ALL
    USING (auth.es_super_admin())
    WITH CHECK (auth.es_super_admin());

CREATE POLICY p_auditoria_super ON auditoria FOR SELECT
    USING (auth.es_super_admin());
