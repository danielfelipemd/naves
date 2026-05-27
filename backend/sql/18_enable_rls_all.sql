-- Activa RLS en todas las tablas publicas. NAVES usa una arquitectura todo-por-backend:
-- todas las consultas pasan por supabaseAdmin (service_role) que BYPASSA RLS, asi que
-- la app sigue funcionando normalmente. anon y authenticated quedan con "default deny"
-- (no hay policies), bloqueando el acceso directo via PostgREST con la anon key publica.
--
-- Tambien borramos las policies viejas de 02_rls.sql que referencian auth.uid() y no
-- aplican a nuestra arquitectura (no usamos Supabase Auth para autorizacion de datos).

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT polname, tablename FROM pg_policies WHERE schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.polname, r.tablename);
  END LOOP;
END$$;

ALTER TABLE public.anteproyectos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_profesor       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_ciiu                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohorte_hitos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohortes                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipos                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historial_equipos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hitos                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.miembro_emociones           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.miembro_preocupaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.miembros_equipo             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participante_emociones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participante_preocupaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participantes_lista         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permisos                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profesores                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyectos                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rol_permisos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sabanas_proyectos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_desarchivado    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_permisos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_roles               ENABLE ROW LEVEL SECURITY;
