-- 50 — Limpieza de sesiones inactivas. Va con la 49.
--
-- APLICAR SOLO DESPUÉS de desplegar el backend que llama a tocar_sesion.
-- Con un backend que no anota actividad, esta tarea vería a todo el mundo
-- inactivo y, pasada una hora, cerraría todas las sesiones.
--
-- Qué hace: cada 5 min cierra las sesiones de quien ya no está, para que su
-- refresh token muera aunque nunca vuelva a hacer una petición (navegador
-- cerrado sin pulsar «Salir»). A quien sigue con la pestaña abierta el backend
-- lo detiene en su siguiente petición; esta tarea cubre a los que no vuelven.
--
-- `created_at < now() - 1 h` deja en paz a una sesión recién creada que
-- todavía no ha hecho su primera petición al backend.
--
-- Reemplaza la tarea de la migración 48 (`purgar-sesiones-inactivas`, 30 días
-- sin renovar el token), cuyo número no lo pidió nadie.

select cron.unschedule('purgar-sesiones-inactivas')
 where exists (select 1 from cron.job where jobname = 'purgar-sesiones-inactivas');

select cron.unschedule('cerrar-sesiones-inactivas')
 where exists (select 1 from cron.job where jobname = 'cerrar-sesiones-inactivas');

select cron.schedule(
  'cerrar-sesiones-inactivas',
  '*/5 * * * *',
  $job$
    delete from auth.sessions s
     where s.created_at < now() - public.inactividad_maxima()
       and not exists (
         select 1 from public.sesion_actividad a
          where a.session_id = s.id
            and a.ultima_actividad >= now() - public.inactividad_maxima())
  $job$
);
