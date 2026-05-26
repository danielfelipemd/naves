-- Split canvas_cliente_problema into 3 separate columns: cliente, problema, solucion
-- Each column 500 chars max (validated en backend con Zod, columna queda TEXT)

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS canvas_cliente  TEXT,
  ADD COLUMN IF NOT EXISTS canvas_problema TEXT,
  ADD COLUMN IF NOT EXISTS canvas_solucion TEXT;

-- Migrar contenido existente al campo "problema" (el más representativo del concepto original)
UPDATE proyectos
   SET canvas_problema = canvas_cliente_problema
 WHERE canvas_cliente_problema IS NOT NULL
   AND (canvas_problema IS NULL OR canvas_problema = '');

ALTER TABLE proyectos DROP COLUMN IF EXISTS canvas_cliente_problema;
