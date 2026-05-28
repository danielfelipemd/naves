-- Sube el cap de miembros_equipo.posicion de 3 a 4. Permite que el
-- super_admin cree equipos excepcionales de 4 personas desde /admin/equipos.
-- El flujo normal del participante (POST /api/equipos) sigue topado en 3
-- via Zod, asi que esto solo desbloquea la via admin.

ALTER TABLE miembros_equipo DROP CONSTRAINT IF EXISTS miembros_equipo_posicion_check;
ALTER TABLE miembros_equipo ADD CONSTRAINT miembros_equipo_posicion_check
  CHECK ((posicion >= 1) AND (posicion <= 4));
