-- =====================================================================
-- 38_actas.sql — Módulo de Actas de Grado (Formato Acta Proyecto de Grado MBA v3)
--
-- Una acta por participante, generada sin digitación desde sábana/programación/
-- participantes. Máquina de estados + cadena de firmas por modalidad + firma en
-- lote. El conector del proveedor de firma (DocuSign/ZapSign/Autentic) queda como
-- stub hasta que se confirme el proveedor; el resto opera completo.
-- Cambios ADITIVOS: no afectan datos existentes.
-- =====================================================================

-- Config: Director MBA de la cohorte (firma el cierre del acta). No existía.
ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS director_mba_nombre TEXT;
ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS director_mba_cargo TEXT;

COMMENT ON COLUMN cohortes.director_mba_nombre IS 'Nombre del Director del MBA que firma el cierre de las actas de esta cohorte.';

-- Una acta por participante.
CREATE TABLE IF NOT EXISTS acta (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cohorte_id text NOT NULL,
  participante_id text NOT NULL,           -- participantes_lista.id
  equipo_id text,
  proyecto_id text,
  modalidad text NOT NULL,                 -- business_plan | caso | proyecto_investigacion
  estado text NOT NULL DEFAULT 'faltan_datos'
    CHECK (estado IN ('faltan_datos','generada','enviada','en_firmas_internas','lista_para_cierre','completa','archivada')),
  -- Datos del acta (cero digitación; copiados al generar). Editable solo el origen.
  nombre_participante text,
  nombre_proyecto text,
  fecha_sustentacion timestamptz,
  lugar text DEFAULT 'INALDE Business School',
  director_nombre text,                    -- profesor asignado (BP) o director de proyecto (Caso/PI)
  director_id text,
  jurados jsonb DEFAULT '[]'::jsonb,        -- [{nombre,email,tipo}] solo Caso/PI
  nota text CHECK (nota IN ('aceptado','rechazado')),  -- resultado de la sustentación
  observaciones text,
  director_mba_nombre text,
  director_mba_cargo text,
  -- Firmas (cadena por modalidad) + faltantes.
  firmas jsonb DEFAULT '[]'::jsonb,         -- [{rol,nombre,email,orden,paralelo,estado,firmada_at,certificado}]
  faltan jsonb DEFAULT '[]'::jsonb,         -- datos faltantes para poder generar
  pdf_path text,
  proveedor_sobre_id text,                  -- id del sobre en el proveedor de firma
  creado_en timestamptz DEFAULT now(),
  enviada_en timestamptz,
  completa_en timestamptz,
  UNIQUE (participante_id)
);
CREATE INDEX IF NOT EXISTS idx_acta_cohorte ON acta (cohorte_id);
CREATE INDEX IF NOT EXISTS idx_acta_estado ON acta (estado);

-- Microformulario para jurados tardíos (Caso/PI sin jurados): enlace sin login al director.
CREATE TABLE IF NOT EXISTS acta_microformulario (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token text UNIQUE NOT NULL,
  cohorte_id text NOT NULL,
  equipo_id text,
  proyecto_id text,
  director_nombre text,
  director_email text,
  expira_en timestamptz,
  usado boolean DEFAULT false,
  diligenciado_por text,
  diligenciado_en timestamptz,
  datos jsonb,                              -- {fecha_sustentacion, jurados:[...], nota}
  creado_en timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acta_micro_token ON acta_microformulario (token);

ALTER TABLE acta ENABLE ROW LEVEL SECURITY;
ALTER TABLE acta_microformulario ENABLE ROW LEVEL SECURITY;
