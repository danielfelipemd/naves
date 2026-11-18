-- 60 · Transporte de ida y de regreso por separado (Daniel, 18/11/2026).
--
-- Antes se preguntaba solo «¿necesita que lo recojamos?»: una dirección y una
-- hora de recogida. El panelista puede necesitar que lo traigan, que lo lleven
-- de vuelta o las dos cosas, y hay que preguntarle ambas.
--
--   direccion_recogida / hora_recogida  → la IDA (se quedan como estaban)
--   transporte_ida / transporte_regreso → qué trayectos pidió (null = no se le preguntó)
--   direccion_regreso / hora_regreso    → a dónde lo llevamos y a qué hora
--                                         (sin dirección = la misma de recogida;
--                                          sin hora = al terminar su último bloque)
--
-- Los días siguen en transporte_por_fecha y valen para los dos trayectos.
-- Solo agrega columnas: el código anterior no las lee y sigue funcionando.
-- Orden de despliegue: este SQL → backend → frontend.

alter table public.logistica_panelista add column if not exists transporte_ida boolean;
alter table public.logistica_panelista add column if not exists transporte_regreso boolean;
alter table public.logistica_panelista add column if not exists direccion_regreso text;
alter table public.logistica_panelista add column if not exists hora_regreso time;

-- Quien ya pidió transporte lo pidió para que lo recogieran: eso es la ida. El
-- regreso no se le preguntó: queda en null («sin preguntar» en el resumen).
update public.logistica_panelista
   set transporte_ida = true
 where necesita_transporte = true and transporte_ida is null;
