-- =====================================================================
-- 41_almuerzo_jornada.sql — El almuerzo como franja propia de la jornada
--
-- Hasta ahora el único corte parametrizable de la escaleta era el break: uno
-- al final de cada bloque, con una duración común a TODA la cohorte
-- (programacion_config.break_min). Un almuerzo había que fingirlo alargando
-- ese break, y entonces se alargaban todos los breaks de todas las jornadas.
--
-- El almuerzo va en `jornadas` y no en `programacion_config` porque es una
-- decisión de cada día: la jornada 1 puede parar 60 minutos a almorzar y la 2
-- no almorzar. Ahí también viven `foto_inicial` e `intro_min`, que son
-- decisiones del mismo tipo.
--
-- `almuerzo_tras_slot` NULL significa automático: el motor lo coloca en el
-- corte de bloque más cercano a la mitad de la jornada (donde ya iría un
-- break, que el almuerzo sustituye). Ponerle un número lo fija a mano.
-- =====================================================================

ALTER TABLE jornadas
    ADD COLUMN IF NOT EXISTS almuerzo BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS almuerzo_min SMALLINT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS almuerzo_tras_slot SMALLINT NULL;

COMMENT ON COLUMN jornadas.almuerzo IS
    '¿Esta jornada para a almorzar? Si es TRUE, el motor de escaleta inserta una franja "Almuerzo".';
COMMENT ON COLUMN jornadas.almuerzo_min IS
    'Duración del almuerzo en minutos, propia de esta jornada (por defecto 60).';
COMMENT ON COLUMN jornadas.almuerzo_tras_slot IS
    'Después de qué presentación cae el almuerzo. NULL = automático (el corte de bloque más cercano a la mitad de la jornada).';

-- Duración razonable: 0 no tiene sentido (sería no almorzar, que ya se dice con
-- almuerzo = FALSE) y más de 4 horas es un error de tecleo.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'jornadas_almuerzo_min_ck'
    ) THEN
        ALTER TABLE jornadas
            ADD CONSTRAINT jornadas_almuerzo_min_ck
            CHECK (almuerzo_min BETWEEN 5 AND 240);
    END IF;
END $$;

-- Después de la presentación 1 como mínimo: el almuerzo parte la jornada, no la
-- abre. Y nunca después de la última (ahí va el cierre) — ese tope depende del
-- número de proyectos asignados, así que lo aplica el motor, no la base.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'jornadas_almuerzo_tras_slot_ck'
    ) THEN
        ALTER TABLE jornadas
            ADD CONSTRAINT jornadas_almuerzo_tras_slot_ck
            CHECK (almuerzo_tras_slot IS NULL OR almuerzo_tras_slot >= 1);
    END IF;
END $$;
