-- 48 — Caducidad de sesión por inactividad.
--
-- GoTrue no caduca las sesiones: ni por tiempo ni por inactividad. Las
-- variables que lo harían (GOTRUE_SECURITY_REFRESH_TOKEN_*, TIMEBOX,
-- INACTIVITY) no se pueden configurar aquí, porque el servicio `auth` del
-- compose enumera sus 29 variables una por una y no usa `env_file`: lo que se
-- ponga en el panel se queda en el .env del host y el contenedor no lo ve.
-- Cambiar eso obliga a tocar la plantilla del compose, que es el repo genérico
-- de upstream.
--
-- Medido el 3-nov-2026, antes de esta migración:
--   109 sesiones vivas, la más antigua creada el 25-ago y sin usarse desde
--   ese día: su refresh token seguía siendo válido 71 días después.
--   81 de las 109 llevaban más de un mes sin uso.
--   147 inicios de sesión contra 28 cierres: el 81% de las sesiones nunca
--   se cierran, así que se acumulan para siempre.
--
-- Una sesión viva ES el acceso: quien se siente en ese navegador entra como
-- esa persona sin escribir la clave. No es una puerta de entrada nueva, pero
-- convierte cualquier filtración puntual en acceso permanente.
--
-- Esto implementa la caducidad por inactividad desde la base, con pg_cron (ya
-- viene precargado en shared_preload_libraries). Va en la base y no en el
-- backend a propósito: así no depende de que el backend esté arriba ni de un
-- temporizador que se pierde en cada despliegue.
--
-- `updated_at` es el indicador correcto de actividad: GoTrue lo mueve en cada
-- renovación del token. Verificado — una sesión pasó de 03:37:40 a 03:48:25
-- al renovar. Una pestaña abierta renueva cada 10 min, así que nunca se le
-- caduca la sesión a alguien que está trabajando.

create extension if not exists pg_cron;

-- El borrado va directo, sin función intermedia: una función en `public` nace
-- con EXECUTE para PUBLIC y anon, y habría que acordarse de revocarlo. Sin
-- función no hay superficie nueva que proteger.
--
-- Borrar la sesión arrastra sus refresh_tokens y mfa_amr_claims: las dos
-- claves ajenas que apuntan a auth.sessions son ON DELETE CASCADE
-- (verificado en pg_constraint).
--
-- 30 días de inactividad. A las 04:00 UTC (23:00 en Colombia): fuera de
-- horario de uso, y si borra la sesión de alguien, se entera al día siguiente
-- al entrar, no a mitad de una jornada de trabajo.
select cron.unschedule('purgar-sesiones-inactivas')
 where exists (select 1 from cron.job where jobname = 'purgar-sesiones-inactivas');

select cron.schedule(
  'purgar-sesiones-inactivas',
  '0 4 * * *',
  $$delete from auth.sessions where updated_at < now() - interval '30 days'$$
);

-- Quién puede tocar `cron`, comprobado y no deducido.
--
-- OJO con la tabla de privilegios: `has_table_privilege('anon','cron.job','SELECT')`
-- devuelve TRUE. El ACL de cron.job trae `=r/supabase_admin`, es decir SELECT
-- concedido a PUBLIC por `supabase_admin`, y un REVOKE solo lo puede hacer
-- quien concedió: ejecutado como `postgres` no falla, simplemente no hace nada.
-- Por eso aquí no se intenta.
--
-- No hace falta: sin USAGE en el esquema no se alcanza nada de dentro, y
-- PostgREST solo expone `public`. Probado de verdad, esperando el rechazo, con
-- `set local role` dentro de una transacción revertida:
--
--   anon         -> leer cron.job        : 42501 permission denied
--   authenticated-> leer cron.job        : 42501 permission denied
--   anon         -> cron.schedule(...)   : 42501 permission denied
--
-- Si algún día se concede USAGE sobre `cron` a un rol de la aplicación, hay
-- que volver a este punto: una tarea programada que pueda crear cualquiera con
-- la llave anónima sería mucho peor que el problema que esta migración
-- resuelve.
