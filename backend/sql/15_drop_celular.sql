-- Eliminar columna celular_encriptado (nunca usada por el backend)
ALTER TABLE participantes_lista DROP COLUMN IF EXISTS celular_encriptado;
