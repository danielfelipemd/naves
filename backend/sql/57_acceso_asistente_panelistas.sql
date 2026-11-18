-- 57 · Acceso por enlace mágico al panel de Panelistas (asistente de programa).
--
-- Pedido de Daniel (18/11/2026): la asistente de programa entra al panel de
-- administración de Panelistas con un enlace mágico, sin cuenta ni clave, y
-- puede hacer ahí todo lo que hace el super admin. La duración la elige el
-- super admin. Un acceso es personal (un correo) y vale para UNA cohorte.
-- Crear y revocar accesos sigue siendo solo del super admin: quien tiene un
-- enlace no puede fabricar otros.
--
-- Se guarda el hash del token (para buscarlo) y el token cifrado (para que el
-- super admin pueda volver a copiarlo o reenviarlo).
--
-- Solo agrega una tabla: el código anterior no la lee.
-- Orden de despliegue: este SQL → backend → frontend.

create table if not exists public.panelistas_acceso (
  id               uuid primary key default gen_random_uuid(),
  cohorte_id       varchar(20) not null references public.cohortes(id) on delete cascade,
  nombre           varchar(150),
  email_encriptado text not null,
  email_hash       varchar(64) not null,
  token_hash       varchar(64) not null unique,
  token_cifrado    text not null,
  vence_at         timestamptz not null,
  revocado_at      timestamptz,
  ultimo_uso_at    timestamptz,
  creado_at        timestamptz not null default now(),
  creado_por       uuid
);
create index if not exists idx_panelistas_acceso_cohorte on public.panelistas_acceso(cohorte_id);

-- Solo el backend (service_role) lee y escribe.
alter table public.panelistas_acceso enable row level security;
revoke all on public.panelistas_acceso from anon, authenticated;
