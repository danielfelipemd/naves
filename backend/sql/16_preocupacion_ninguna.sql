-- Agregar 'ninguna' (Aún no me preocupa nada) al CHECK de miembro_preocupaciones
ALTER TABLE miembro_preocupaciones DROP CONSTRAINT IF EXISTS miembro_preocupaciones_preocupacion_check;
ALTER TABLE miembro_preocupaciones
  ADD CONSTRAINT miembro_preocupaciones_preocupacion_check
  CHECK (preocupacion IN ('financiera','estres','habilidades','familia','ninguna'));
