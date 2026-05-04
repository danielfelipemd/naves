CREATE OR REPLACE FUNCTION buscar_ciiu(q TEXT, lim INT DEFAULT 20)
RETURNS TABLE(codigo VARCHAR, descripcion VARCHAR, seccion CHAR) AS $func$
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
              AND unaccent(c.descripcion) ILIKE '%' || unaccent(q) || '%'
            ORDER BY similarity(unaccent(c.descripcion), unaccent(q)) DESC
            LIMIT lim;
    END IF;
END;
$func$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION buscar_ciiu(TEXT, INT) TO anon, authenticated, service_role;
