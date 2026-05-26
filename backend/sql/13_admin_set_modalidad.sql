-- Permite que el admin cambie la modalidad (tipo_trabajo_grado) de un participante
-- saltándose el trigger de inmutabilidad. Cualquier UPDATE directo sigue bloqueado.

-- 1) Trigger respeta una variable de sesión 'app.allow_modalidad_change'
CREATE OR REPLACE FUNCTION fn_lock_tipo_trabajo_grado() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_modalidad_change', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.tipo_trabajo_grado IS NOT NULL
     AND NEW.tipo_trabajo_grado IS DISTINCT FROM OLD.tipo_trabajo_grado THEN
    RAISE EXCEPTION 'TIPO_TRABAJO_GRADO_INMUTABLE'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Función SECURITY DEFINER que el admin puede llamar vía RPC.
--    Establece la flag de sesión y hace el UPDATE en una sola transacción.
CREATE OR REPLACE FUNCTION admin_set_modalidad(p_id uuid, p_modalidad tipo_trabajo_grado)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.allow_modalidad_change', 'true', true);
  UPDATE participantes_lista
    SET tipo_trabajo_grado = p_modalidad,
        tipo_trabajo_grado_fijado_at = NOW()
    WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_set_modalidad(uuid, tipo_trabajo_grado) TO service_role;
