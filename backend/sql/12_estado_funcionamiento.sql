-- Agregar 'funcionamiento' (empresa en funcionamiento - intraemprendimiento) al CHECK de proyectos.estado

ALTER TABLE proyectos DROP CONSTRAINT IF EXISTS proyectos_estado_check;

ALTER TABLE proyectos
  ADD CONSTRAINT proyectos_estado_check
  CHECK (estado IN ('idea','investigacion','prototipo','validacion','funcionamiento'));
