-- =====================================================================
-- 31_publicar_programacion.sql — Publicación definitiva de la programación
--
-- Hasta ahora la programación era un borrador permanente: el admin podía
-- reordenar en cualquier momento y no había forma de saber si lo que se veía era
-- definitivo. Eso importa desde que hay más consumidores (la Programación
-- Interna de marketing, operaciones y asistente de programa): si trabajan sobre
-- un borrador que después cambia, montan el evento con horarios equivocados.
--
-- `publicada_at` es el punto de no retorno. Una vez marcado:
--   · la programación deja de ser editable (lo impone backend/src/routes/programacion.ts),
--   · y solo entonces las áreas la ven.
--
-- Es deliberadamente irreversible: no hay endpoint para despublicar. Corregir
-- una programación ya publicada exige entrar a la base de datos a mano, y esa
-- fricción es el punto — "publicar" tiene que significar algo.
-- =====================================================================

ALTER TABLE programacion_config ADD COLUMN IF NOT EXISTS publicada_at  TIMESTAMPTZ;
ALTER TABLE programacion_config ADD COLUMN IF NOT EXISTS publicada_por UUID;

COMMENT ON COLUMN programacion_config.publicada_at IS
    'Momento en que la programación se publicó. NULL = borrador (editable, invisible para las áreas). No NULL = definitiva: ni el admin puede modificarla.';
COMMENT ON COLUMN programacion_config.publicada_por IS
    'auth_user_id del super_admin que publicó.';
