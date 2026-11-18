-- 58 · Enlaces mágicos de la programación para cada público.
--
-- Pedido de Daniel (18/11/2026). Tres públicos reciben la programación, cada
-- uno con lo suyo:
--   asistentes     → la tabla para imprimir y pegar en carteleras: todo menos
--                    el post de LinkedIn, el logo y el One Pager.
--   marketing      → todo: resumen, post de LinkedIn y logo (sin One Pager).
--   publicaciones  → la programación con los One Pagers (y un ZIP con todos).
-- Cada enlace es personal (lleva el nombre de a quién se le dio), dura como
-- máximo 10 días, se puede abrir las veces que haga falta en ese plazo y se
-- puede revocar. El sistema NO lo envía: se genera, se copia y el super admin
-- lo manda por el medio que prefiera.
--
-- Solo agrega una tabla: el código anterior no la lee.
-- Orden de despliegue: este SQL → backend → frontend.

create table if not exists public.programacion_enlaces (
  id             uuid primary key default gen_random_uuid(),
  cohorte_id     varchar(20) not null references public.cohortes(id) on delete cascade,
  publico        varchar(20) not null check (publico in ('asistentes', 'marketing', 'publicaciones')),
  nombre         varchar(150) not null,
  token_hash     varchar(64) not null unique,
  token_cifrado  text not null,
  vence_at       timestamptz not null,
  revocado_at    timestamptz,
  ultimo_uso_at  timestamptz,
  creado_at      timestamptz not null default now(),
  creado_por     uuid
);
create index if not exists idx_programacion_enlaces_cohorte on public.programacion_enlaces(cohorte_id);

-- Solo el backend (service_role) lee y escribe.
alter table public.programacion_enlaces enable row level security;
revoke all on public.programacion_enlaces from anon, authenticated;
