-- =====================================================================
-- Buscador CIIU: sobrevivir a un cambio de servidor Postgres
--
-- Al migrar la base a otro servidor, `unaccent` y `pg_trgm` no venían
-- instaladas y el buscador de códigos CIIU respondía 500:
--   "function unaccent(character varying) does not exist"
--
-- Dos causas, las dos arregladas aquí:
--  1. Faltaban las extensiones.
--  2. `buscar_ciiu` llamaba a `unaccent()`/`similarity()` sin calificar el
--     esquema y sin `search_path` fijo. En Supabase las extensiones viven en
--     `extensions`, que no está en el search_path por defecto de la función,
--     así que no las encontraba ni estando instaladas.
--
-- Idempotente: se puede re-aplicar sin romper nada.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.buscar_ciiu(q TEXT, lim INT DEFAULT 20)
RETURNS TABLE(codigo VARCHAR, descripcion VARCHAR, seccion CHAR)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
BEGIN
    IF q ~ '^[0-9]{1,4}$' THEN
        RETURN QUERY
            SELECT c.codigo, c.descripcion, c.seccion
            FROM codigos_ciiu c
            WHERE c.activo AND c.codigo LIKE q || '%'
            ORDER BY c.codigo
            LIMIT lim;
    ELSE
        RETURN QUERY
            SELECT c.codigo, c.descripcion, c.seccion
            FROM codigos_ciiu c
            WHERE c.activo
              AND extensions.unaccent(c.descripcion) ILIKE '%' || extensions.unaccent(q) || '%'
            ORDER BY extensions.similarity(extensions.unaccent(c.descripcion), extensions.unaccent(q)) DESC
            LIMIT lim;
    END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.buscar_ciiu(TEXT, INT) TO anon, authenticated, service_role;
