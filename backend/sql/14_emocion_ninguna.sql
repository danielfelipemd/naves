-- Agregar 'ninguna' (Aún no siento emoción) al CHECK de miembro_emociones.emocion
ALTER TABLE miembro_emociones DROP CONSTRAINT IF EXISTS miembro_emociones_emocion_check;
ALTER TABLE miembro_emociones
  ADD CONSTRAINT miembro_emociones_emocion_check
  CHECK (emocion IN ('crear','dinero','problema','autonomia','ninguna'));
