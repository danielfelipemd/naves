-- =====================================================================
-- 42_break_y_almuerzo_jornada.sql — El break y el almuerzo son DOS cosas
--
-- La migración 41 metió una sola pausa larga parametrizable por jornada y la
-- llamó "almuerzo". En la práctica se usó para lo que hacía falta: un BREAK
-- largo a mitad de mañana (07:40–08:40, que de almuerzo no tiene nada). Es
-- decir, para poner un break había que llamarlo almuerzo, y entonces la
-- jornada ya no podía tener además un almuerzo de verdad.
--
-- Aquí se separan:
--   · break_jornada*  — la pausa larga propia de la jornada (lo que ya existía).
--                       Se queda con los datos actuales, que es lo que son.
--   · almuerzo*       — campo NUEVO, apagado, para el almuerzo real.
--
-- Los dos son de la jornada y no de la cohorte porque son decisiones de cada
-- día: la jornada 1 puede parar a almorzar y la 2 no. El break AUTOMÁTICO de
-- fin de bloque sigue viviendo en programacion_config.break_min y no se toca.
-- =====================================================================

-- 1) Lo que hoy se llama "almuerzo" pasa a llamarse break de jornada.
--    Los renombres no son idempotentes por sí solos: se comprueba antes.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'jornadas' AND column_name = 'almuerzo_tras_slot'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'jornadas' AND column_name = 'break_jornada_tras_slot'
    ) THEN
        ALTER TABLE jornadas RENAME COLUMN almuerzo           TO break_jornada;
        ALTER TABLE jornadas RENAME COLUMN almuerzo_min       TO break_jornada_min;
        ALTER TABLE jornadas RENAME COLUMN almuerzo_tras_slot TO break_jornada_tras_slot;
    END IF;
END $$;

-- Las restricciones de la 41 viajan con el renombre, pero conservan el nombre
-- viejo. Se renombran para que digan lo que comprueban.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jornadas_almuerzo_min_ck') THEN
        ALTER TABLE jornadas RENAME CONSTRAINT jornadas_almuerzo_min_ck TO jornadas_break_jornada_min_ck;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jornadas_almuerzo_tras_slot_ck') THEN
        ALTER TABLE jornadas RENAME CONSTRAINT jornadas_almuerzo_tras_slot_ck TO jornadas_break_jornada_tras_slot_ck;
    END IF;
END $$;

COMMENT ON COLUMN jornadas.break_jornada IS
    '¿Esta jornada tiene un break largo propio? Si es TRUE, el motor de escaleta inserta una franja "Break". Es independiente del break automático de fin de bloque (programacion_config.break_min).';
COMMENT ON COLUMN jornadas.break_jornada_min IS
    'Duración de ese break en minutos, propia de esta jornada (por defecto 60).';
COMMENT ON COLUMN jornadas.break_jornada_tras_slot IS
    'Después de qué presentación cae el break de la jornada. NULL = automático (el corte de bloque más cercano a la mitad).';

-- 2) El almuerzo, ahora sí, como campo propio y NUEVO. Nace apagado: una
--    jornada que hoy tiene break no gana un almuerzo por esta migración.
ALTER TABLE jornadas
    ADD COLUMN IF NOT EXISTS almuerzo BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS almuerzo_min SMALLINT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS almuerzo_tras_slot SMALLINT NULL;

COMMENT ON COLUMN jornadas.almuerzo IS
    '¿Esta jornada para a almorzar? Si es TRUE, el motor de escaleta inserta una franja "Almuerzo", aparte del break.';
COMMENT ON COLUMN jornadas.almuerzo_min IS
    'Duración del almuerzo en minutos, propia de esta jornada (por defecto 60).';
COMMENT ON COLUMN jornadas.almuerzo_tras_slot IS
    'Después de qué presentación cae el almuerzo. NULL = automático (el corte de bloque más cercano a la mitad).';

-- Mismos topes que para el break: 0 minutos sería "no almorzar" (eso ya lo dice
-- almuerzo = FALSE) y más de 4 horas es un error de tecleo.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jornadas_almuerzo_min_ck2') THEN
        ALTER TABLE jornadas
            ADD CONSTRAINT jornadas_almuerzo_min_ck2
            CHECK (almuerzo_min BETWEEN 5 AND 240);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jornadas_almuerzo_tras_slot_ck2') THEN
        ALTER TABLE jornadas
            ADD CONSTRAINT jornadas_almuerzo_tras_slot_ck2
            CHECK (almuerzo_tras_slot IS NULL OR almuerzo_tras_slot >= 1);
    END IF;
END $$;
