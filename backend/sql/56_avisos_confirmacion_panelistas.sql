-- 56 · A quién avisar cuando un panelista confirma por el enlace.
--
-- Pedido de Daniel (18/11/2026): cada confirmación debe llegarle al panelista,
-- al super admin (Juan Manuel Vicaría, en su correo personal: la cuenta de
-- super admin del sistema es la genérica admin@naves.com) y a la asistente de
-- programa. Se guarda por cohorte, junto al enlace, y se edita desde la tarjeta
-- del enlace en Panelistas: las personas cambian y no deben quedar en el código.
--
-- Solo agrega una columna con default: el código anterior no la lee.
-- Orden de despliegue: este SQL → backend → frontend.

alter table public.panelistas_enlace
  add column if not exists avisar_a text[] not null default '{}';
