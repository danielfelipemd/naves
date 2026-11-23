-- 61 — El super admin manda sobre las actas, y el Caso lleva calificación.
--
-- 1) ajuste_admin: lo que el super admin pone a mano en un acta (jurados,
--    fecha, proyecto, director, calificación, «generar ya»). La generación
--    automática lo aplica POR ENCIMA del cronograma y del microformulario.
--    Antes un Caso quedaba trabado hasta que su director llenaba el
--    microformulario: nadie más podía poner los jurados.
--
-- 2) calificacion: escala del acta de Caso (A, B+, B, B-, C). El resultado
--    aceptado/rechazado (nota) se sigue guardando, deducido de la calificación,
--    para que el resto del sistema (avance, lotes, Mi acta) no cambie.
--
-- Idempotente. Cambios ADITIVOS: no tocan datos existentes.

alter table acta add column if not exists ajuste_admin jsonb;
alter table acta add column if not exists calificacion text;

alter table acta drop constraint if exists acta_calificacion_check;
alter table acta add constraint acta_calificacion_check
  check (calificacion is null or calificacion in ('A', 'B+', 'B', 'B-', 'C'));

comment on column acta.ajuste_admin is
  'Datos puestos a mano por el super admin: {nombre_proyecto, fecha_sustentacion, director_nombre, director_email, jurados, calificacion, forzar, por, en}. Mandan sobre el cronograma y el microformulario.';
comment on column acta.calificacion is
  'Calificación del Caso: A, B+, B, B-, C. Null en Business Plan y Proyecto de Investigación.';
