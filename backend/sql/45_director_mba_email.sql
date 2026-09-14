-- =====================================================================
-- 45_director_mba_email.sql — Correo del Director MBA de la cohorte.
--
-- El Director MBA firma TODAS las actas (las 82 de la cohorte, sin importar la
-- modalidad), pero se configura como texto libre en `cohortes`: no es un
-- usuario del sistema ni está en `profesores`/`directores`. Sin un correo
-- asociado no hay a dónde mandarle su enlace de firma.
--
-- Se añade el campo en vez de obligar a que el nombre coincida con alguna
-- tabla: el nombre puede escribirse de varias formas ("Álvaro Moreno García"
-- vs "Álvaro José Moreno García") y una coincidencia por texto es frágil.
--
-- Idempotente y aditivo.
-- =====================================================================

ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS director_mba_email TEXT;

COMMENT ON COLUMN cohortes.director_mba_email IS
  'Correo del Director MBA, para enviarle su enlace de firma de actas.';
