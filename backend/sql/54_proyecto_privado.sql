-- 54 · Proyectos privados: fuera de la programación.
--
-- Pedido de Daniel/JMV (17/11/2026): en «Trabajos de grado definitivos» una
-- casilla «Privado». Marcado, el proyecto sigue en la base de proyectos pero no
-- entra a la programación: ni al reparto, ni a las jornadas, ni a los avisos.
--
-- Solo agrega una columna con default false: el código anterior no la lee y
-- sigue funcionando igual. Orden de despliegue: este SQL → backend → frontend.

alter table public.proyectos
  add column if not exists privado boolean not null default false;
