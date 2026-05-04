-- =====================================================
-- NAVES — Auditoría automática vía triggers
-- Captura INSERT/UPDATE/DELETE en tablas críticas
-- =====================================================

-- Función genérica de auditoría
CREATE OR REPLACE FUNCTION fn_audit_row() RETURNS TRIGGER AS $$
DECLARE
    actor_role TEXT;
    actor_uuid UUID;
    detalles_json JSONB;
BEGIN
    -- Identificar actor desde JWT
    actor_role := COALESCE(auth.app_role(), 'sistema');
    actor_uuid := COALESCE(auth.participante_id(), auth.profesor_id());

    -- Construir payload de cambios
    IF TG_OP = 'DELETE' THEN
        detalles_json := jsonb_build_object('op','DELETE','before', to_jsonb(OLD));
    ELSIF TG_OP = 'INSERT' THEN
        detalles_json := jsonb_build_object('op','INSERT','after', to_jsonb(NEW));
    ELSE -- UPDATE
        detalles_json := jsonb_build_object(
            'op','UPDATE',
            'before', to_jsonb(OLD),
            'after', to_jsonb(NEW)
        );
    END IF;

    INSERT INTO auditoria(actor_tipo, actor_id, accion, entidad_tipo, entidad_id, detalles)
    VALUES (
        actor_role,
        actor_uuid,
        TG_OP || '_' || TG_TABLE_NAME,
        TG_TABLE_NAME,
        COALESCE((NEW).id, (OLD).id)::UUID,
        detalles_json
    );

    RETURN COALESCE(NEW, OLD);
EXCEPTION
    WHEN OTHERS THEN
        -- No bloquear la operación si la auditoría falla
        RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aplicar trigger a tablas críticas
CREATE TRIGGER trg_audit_equipos
    AFTER INSERT OR UPDATE OR DELETE ON equipos
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_miembros_equipo
    AFTER INSERT OR UPDATE OR DELETE ON miembros_equipo
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_anteproyectos
    AFTER INSERT OR UPDATE OR DELETE ON anteproyectos
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_proyectos
    AFTER INSERT OR UPDATE OR DELETE ON proyectos
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_solicitudes
    AFTER INSERT OR UPDATE OR DELETE ON solicitudes_desarchivado
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_asignaciones
    AFTER INSERT OR UPDATE OR DELETE ON asignaciones_profesor
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

CREATE TRIGGER trg_audit_sabanas
    AFTER INSERT OR UPDATE OR DELETE ON sabanas_proyectos
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

-- Función para registrar acciones de auth (login, logout, recovery) — llamada desde backend
CREATE OR REPLACE FUNCTION fn_log_auth_event(
    p_actor_tipo TEXT,
    p_actor_id UUID,
    p_accion TEXT,
    p_detalles JSONB DEFAULT NULL,
    p_ip INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    new_id BIGINT;
BEGIN
    INSERT INTO auditoria(actor_tipo, actor_id, accion, detalles, ip, user_agent)
    VALUES (p_actor_tipo, p_actor_id, p_accion, p_detalles, p_ip, p_user_agent)
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
