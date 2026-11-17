-- 52 · Proyectos fijados a una jornada.
--
-- Pedido de JMV (17/11/2026): hay casos especiales que deben presentar un día
-- concreto (p. ej. el 24). «Repartir entre las jornadas» los deja en su jornada
-- y acomoda a los demás alrededor.
--
-- jornada_fija : número de jornada (1, 2…) en que debe presentar el proyecto;
--                NULL = libre, el reparto decide.
--
-- Solo agrega una columna que admite NULL: el código anterior no la lee y sigue
-- funcionando igual. Orden de despliegue: este SQL → backend → frontend.

alter table public.proyectos
  add column if not exists jornada_fija smallint
    check (jornada_fija is null or jornada_fija between 1 and 9);
