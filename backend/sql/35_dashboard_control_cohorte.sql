-- =====================================================================
-- 35_dashboard_control_cohorte.sql — Dashboard de control de la cohorte
--                                    (Comentario 15 QA, JMV 20-jul-2026)
--
-- El dashboard de control (KPIs + barras de avance + caracterización) se calcula
-- casi todo por AGREGACIÓN de datos que ya existen (participantes, equipos,
-- anteproyectos, entregas, checkboxes de Reunión 1/2, programación, perfil
-- emprendedor del registro). Lo único que no existía es el indicador binario del
-- INFORME de cohorte (realizado / no realizado).
--
-- El bloque de ACTAS del dashboard depende del módulo de Actas de Grado, que aún
-- no está construido; hasta entonces el dashboard lo muestra como "no disponible".
--
-- Cambio ADITIVO (con default): no afecta datos existentes.
-- =====================================================================

-- Informe de cohorte realizado: checkbox binario para el bloque 3 del dashboard.
ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS informe_cohorte_realizado BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN cohortes.informe_cohorte_realizado IS
    'Indicador binario del "Informe de cohorte" para el dashboard de control (Comentario 15). Lo marca el super_admin.';
