-- 49 — La sesión se cierra tras 1 hora sin actividad real.
--
-- POLÍTICA (decidida por el dueño del sistema, 3-nov-2026): la sesión vive
-- mientras la persona usa la aplicación y se cierra tras 1 hora sin usarla.
-- Reemplaza la tarea de la migración 48 (borrar sesiones con 30 días sin
-- renovar), cuyo número no lo pidió nadie.
--
-- Por qué la actividad se mide aquí y no en auth.sessions.updated_at:
-- GoTrue mueve updated_at en cada renovación del token, y el frontend renueva
-- solo cada 10 min mientras la pestaña esté abierta. Medido el 3-nov: una
-- sesión llevaba 935 horas viva con una pestaña abierta. Esa columna mide la
-- actividad del token, no la de la persona.
--
-- Por eso el backend anota aquí la actividad REAL: cada petición de la persona
-- cuenta; las consultas en segundo plano (la campana de avisos cada 60 s, el
-- autoguardado del anteproyecto cada 30 s, el sondeo de la sábana) llegan
-- marcadas y no cuentan. Si contaran, ninguna pestaña abierta expiraría nunca.

-- La hora vive en un solo sitio. tocar_sesion y la tarea de limpieza la leen
-- de aquí; el frontend (auth/actividad.ts) repite el valor para el aviso
-- previo y su comentario apunta a esta función.
create or replace function public.inactividad_maxima()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '1 hour' $$;

revoke all on function public.inactividad_maxima() from public, anon, authenticated;

create table if not exists public.sesion_actividad (
  -- ON DELETE CASCADE: al cerrar sesión, cambiar la clave o revocar, GoTrue
  -- borra la fila de auth.sessions y esta se va con ella.
  session_id       uuid primary key references auth.sessions(id) on delete cascade,
  user_id          uuid not null,
  ultima_actividad timestamptz not null default now()
);

-- Solo la escribe tocar_sesion (SECURITY DEFINER). Ningún rol de la app la
-- toca: RLS sin políticas y, además, sin privilegios — una tabla con RLS y sin
-- política no rechaza un UPDATE, lo deja en 0 filas en silencio.
alter table public.sesion_actividad enable row level security;
revoke all on public.sesion_actividad from public, anon, authenticated;

-- Comprueba la sesión y anota la actividad, en una sola ida y vuelta.
--   'inexistente' — la sesión ya no existe (cerró sesión, cambió la clave,
--                   se revocó). El backend responde 401 SESION_CERRADA.
--   'expirada'    — lleva más de inactividad_maxima() sin actividad real. Se
--                   borra la sesión aquí mismo, para que también muera su
--                   refresh token. El backend responde 401 SESION_EXPIRADA.
--   'ok'          — sigue viva. Si p_contar, se anota la actividad.
--
-- Una sesión que se ve por primera vez es un ingreso recién hecho: cuenta
-- como actividad.
create or replace function public.tocar_sesion(p_session uuid, p_contar boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_ultima timestamptz;
begin
  select s.user_id into v_user from auth.sessions s where s.id = p_session;
  if not found then
    return 'inexistente';
  end if;

  select a.ultima_actividad into v_ultima
    from public.sesion_actividad a where a.session_id = p_session;

  if not found then
    insert into public.sesion_actividad (session_id, user_id, ultima_actividad)
    values (p_session, v_user, now())
    on conflict (session_id) do nothing;
    return 'ok';
  end if;

  if v_ultima < now() - public.inactividad_maxima() then
    delete from auth.sessions where id = p_session;
    return 'expirada';
  end if;

  if p_contar then
    update public.sesion_actividad set ultima_actividad = now()
     where session_id = p_session;
  end if;
  return 'ok';
end
$$;

-- Toda función nueva nace con EXECUTE para PUBLIC y anon. Esta salta RLS y
-- borra sesiones: solo el backend (service_role) la puede llamar.
revoke all on function public.tocar_sesion(uuid, boolean) from public, anon, authenticated;
grant execute on function public.tocar_sesion(uuid, boolean) to service_role;

-- Las sesiones que ya existen al aplicar esto arrancan con actividad = ahora.
-- Sin esto, la limpieza las vería sin actividad y cerraría a todo el mundo de
-- golpe, incluido a quien está trabajando en ese momento.
insert into public.sesion_actividad (session_id, user_id, ultima_actividad)
select s.id, s.user_id, now() from auth.sessions s
on conflict (session_id) do nothing;

-- La limpieza programada va en 50_sesion_inactividad_limpieza.sql: se aplica
-- DESPUÉS de desplegar el backend que llama a tocar_sesion.
