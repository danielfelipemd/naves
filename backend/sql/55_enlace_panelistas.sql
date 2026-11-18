-- 55 · Enlace compartido para panelistas.
--
-- Pedido de Daniel (18/11/2026): llevar al sistema lo que hacía el sitio alterno
-- (navesfs.netlify.app/panelistas). Un solo enlace por cohorte, que el super
-- admin activa, desactiva y deja vigente hasta una fecha. Quien lo abre ve la
-- programación por bloques (logo, proyecto, autores, resumen y One Pager), elige
-- «todas» o bloque por bloque, deja nombre y correo y su logística (transporte;
-- desayuno y almuerzo cualquier día). Cualquiera con el enlace puede confirmar:
-- si el correo no estaba en la lista, entra como registro nuevo.
--
-- Un «bloque» son las presentaciones de una jornada entre dos pausas (break o
-- almuerzo), tal como las arma la escaleta (services/escaleta.ts). Se guarda por
-- número dentro de la jornada.
--
-- Solo agrega tablas y columnas con default: el código anterior no las lee y
-- sigue funcionando igual. Orden de despliegue: este SQL → backend → frontend.

-- Un enlace por cohorte. Se guarda el hash para buscarlo (lo que llega en la URL)
-- y el token cifrado para que el admin pueda volver a copiarlo: es un enlace que
-- se comparte, no uno que se manda una vez.
create table if not exists public.panelistas_enlace (
  cohorte_id      varchar(20) primary key references public.cohortes(id) on delete cascade,
  token_hash      varchar(64) not null unique,
  token_cifrado   text not null,
  activo          boolean not null default false,
  vence_at        timestamptz not null,
  creado_at       timestamptz not null default now(),
  actualizado_at  timestamptz not null default now()
);

-- Los bloques que eligió cada panelista. «Todas» va en panelistas.asiste_todas;
-- panelista_jornadas se sigue llenando (los días con algún bloque) porque de ahí
-- leen la Programación Interna y el resumen logístico.
create table if not exists public.panelista_bloques (
  panelista_id  uuid not null references public.panelistas(id) on delete cascade,
  jornada_id    uuid not null references public.jornadas(id) on delete cascade,
  bloque        smallint not null check (bloque >= 1),
  creado_at     timestamptz not null default now(),
  primary key (panelista_id, jornada_id, bloque)
);

-- registro_por_enlace: llegó por el enlace y no estaba en la lista (el admin lo
-- ve marcado como «Nuevo registro», igual que en el sitio alterno).
-- confirmacion_enviada_at: cuándo se le mandó el correo de confirmación.
alter table public.panelistas add column if not exists registro_por_enlace boolean not null default false;
alter table public.panelistas add column if not exists confirmacion_enviada_at timestamptz;

-- Solo el backend (service_role) lee y escribe. RLS activo sin políticas y sin
-- permisos para anon/authenticated: nadie entra por la API REST.
alter table public.panelistas_enlace enable row level security;
alter table public.panelista_bloques enable row level security;
revoke all on public.panelistas_enlace from anon, authenticated;
revoke all on public.panelista_bloques from anon, authenticated;
