-- =====================================================================
-- 44_firma_actas.sql — Firma electrónica propia de las actas.
--
-- Dos piezas:
--  1) Enlaces de firma con alcance CERRADO: cada enlace sirve para firmar
--     unas actas concretas y para nada más. No es una sesión del sistema.
--  2) Sello de integridad en cada firma (el hash y el HMAC viven dentro del
--     jsonb `acta.firmas`, así que no hacen falta columnas nuevas).
--
-- Idempotente. Cambios ADITIVOS: no tocan datos existentes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS acta_enlace_firma (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Se guarda el HASH del token, nunca el token. Si alguien lee esta tabla no
  -- puede reconstruir los enlaces: el original solo viaja en el correo.
  token_hash text UNIQUE NOT NULL,
  cohorte_id text NOT NULL,
  -- A quién se le envió y en calidad de qué. El enlace SOLO puede firmar con
  -- este rol y este nombre: no sirve para firmar en lugar de otra persona.
  rol text NOT NULL,
  firmante_nombre text NOT NULL,
  firmante_email text,
  -- Actas que este enlace puede firmar. Cerrado: cualquier otra acta se rechaza.
  acta_ids bigint[] NOT NULL DEFAULT '{}',
  -- Comprobación de identidad al abrir (últimos dígitos del documento), para
  -- que el enlace filtrado no baste por sí solo.
  verificacion_hash text,
  expira_en timestamptz NOT NULL,
  usado_en timestamptz,
  revocado boolean NOT NULL DEFAULT false,
  -- Rastro de uso: intentos fallidos de verificación y desde dónde se abrió.
  intentos_fallidos int NOT NULL DEFAULT 0,
  ultimo_ip text,
  ultimo_user_agent text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  creado_por text
);

CREATE INDEX IF NOT EXISTS idx_acta_enlace_token ON acta_enlace_firma (token_hash);
CREATE INDEX IF NOT EXISTS idx_acta_enlace_cohorte ON acta_enlace_firma (cohorte_id);

COMMENT ON TABLE acta_enlace_firma IS
  'Enlaces de firma de actas con alcance cerrado: sirven para firmar las actas listadas y nada más. No otorgan sesión ni acceso al resto del sistema.';
COMMENT ON COLUMN acta_enlace_firma.token_hash IS
  'SHA-256 del token. El token en claro solo existe en el correo enviado.';
COMMENT ON COLUMN acta_enlace_firma.acta_ids IS
  'Actas que este enlace puede firmar. Firmar cualquier otra se rechaza.';

ALTER TABLE acta_enlace_firma ENABLE ROW LEVEL SECURITY;
