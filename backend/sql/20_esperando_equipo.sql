-- Nuevo estado para el flujo de formacion de equipos: el participante eligio
-- modalidad pero declaro explicitamente "voy a esperar a que alguien me agregue"
-- (no quiere crear equipo). Mientras este flag este seteado y el participante
-- no tenga equipo, su Dashboard queda bloqueado mostrando un mensaje de espera.
-- Cuando alguien lo agrega a un equipo, el backend limpia el flag.

ALTER TABLE participantes_lista
  ADD COLUMN IF NOT EXISTS esperando_equipo_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_participantes_esperando_equipo
  ON participantes_lista(esperando_equipo_at)
  WHERE esperando_equipo_at IS NOT NULL;
