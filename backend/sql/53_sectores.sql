-- 53 · Catálogo de sectores editable por el súper admin.
--
-- Pedido de Daniel/JMV (17/11/2026): el súper admin agrega, renombra, ordena y
-- oculta sectores sin pedirlo a desarrollo. Antes la lista vivía en el código
-- (frontend/src/lib/sectores.ts), que queda como respaldo si la API falla.
--
-- proyectos.sector sigue siendo texto (no FK): renombrar un sector actualiza
-- los proyectos desde el backend; ocultarlo (activo = false) no toca proyectos.
--
-- Solo crea una tabla nueva: el código anterior no la lee. Orden de
-- despliegue: este SQL → backend → frontend.

create table if not exists public.sectores (
  id          serial primary key,
  nombre      varchar(100) not null unique,
  orden       integer not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.sectores enable row level security;

insert into public.sectores (nombre, orden) values
  ('Agro y Agroindustria', 10),
  ('Alimentos y Bebidas', 20),
  ('Salud / HealthTech', 30),
  ('Tecnología / Software / IA', 40),
  ('Plataformas digitales / Marketplace', 50),
  ('Servicios financieros / Fintech / Insurtech', 60),
  ('Inmobiliario / Construcción / Proptech', 70),
  ('Energía / Movilidad', 80),
  ('Energía', 90),
  ('Industrial', 100),
  ('Oil & Gas', 110),
  ('Economía circular / Reciclaje / Ambiental', 120),
  ('Educación / Edtech', 130),
  ('Moda / Vestuario y Calzado / Lujo', 140),
  ('Retail / Productos de consumo', 150),
  ('Logística / Transporte / Comercio exterior', 160),
  ('Turismo / Entretenimiento / Cultura', 170),
  ('Consultoría y servicios profesionales', 180),
  ('Bienestar / Deporte / Servicios personales', 190),
  ('Sector social', 200),
  ('Otro', 210)
on conflict (nombre) do nothing;
