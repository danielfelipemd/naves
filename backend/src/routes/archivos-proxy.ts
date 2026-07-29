import { Router } from 'express';
import { downloadTrabajoGradoFile, verificarTokenArchivo } from '../services/storage.js';

const router = Router();

/**
 * GET /api/archivos/stream?t=<token>
 *
 * Endpoint publico (sin Authorization) que valida un token efimero (HS256,
 * 5 min) emitido por endpoints autenticados y hace stream del archivo desde
 * Supabase Storage al cliente. Sirve para que el navegador pueda abrir el
 * archivo directamente en una pestaña nueva sin exponer la URL firmada de
 * Supabase (que tiene el dominio `*.supabase.co`).
 */
router.get('/stream', async (req, res) => {
  const token = (req.query.t as string | undefined) ?? '';
  if (!token) return res.status(400).json({ error: 'TOKEN_REQUERIDO' });

  let path: string;
  let mime: string;
  try {
    ({ path, mime } = verificarTokenArchivo(token));
  } catch {
    return res.status(403).json({ error: 'TOKEN_INVALIDO_O_EXPIRADO' });
  }

  let buf: Buffer;
  try {
    buf = await downloadTrabajoGradoFile(path);
  } catch {
    return res.status(404).json({ error: 'ARCHIVO_NO_DISPONIBLE' });
  }

  const filename = path.split('/').pop() ?? 'archivo';
  res.setHeader('Content-Type', mime);
  // Por defecto `attachment`: fuerza al navegador a descargar el archivo (no
  // abrirlo en pestaña). Eso evita la ventana en blanco que aparecia con
  // window.open + inline, y deja un flujo limpio: click -> dialogo 'Guardar
  // como' -> fin. Si el usuario cancela, volver a darle click lo repite.
  //
  // Con `?v=1` se sirve `inline`, que es lo que necesita el visor emergente
  // (VisorArchivo) para mostrar el archivo incrustado sin sacar al usuario de
  // la pantalla en la que esta.
  const verIncrustado = req.query.v === '1';
  res.setHeader(
    'Content-Disposition',
    `${verIncrustado ? 'inline' : 'attachment'}; filename="${filename}"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});

export default router;
