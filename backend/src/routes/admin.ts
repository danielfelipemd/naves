import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { encryptPII, sha256Hex } from '../auth/crypto.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth(), requireRole('super_admin'));

/**
 * POST /api/admin/participantes/cargar-excel
 * Multipart: cohorte_id (form field), file (xlsx)
 * Columnas esperadas: nombre_completo, cedula, email
 */
router.post('/participantes/cargar-excel', upload.single('file'), async (req: AuthenticatedRequest, res) => {
  const cohorteId = String(req.body?.cohorte_id ?? '').trim();
  if (!cohorteId) return res.status(400).json({ error: 'MISSING_COHORTE' });
  if (!req.file) return res.status(400).json({ error: 'MISSING_FILE' });

  // Verifica cohorte
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  const wb = new ExcelJS.Workbook();
  // multer's Buffer<ArrayBufferLike> is structurally compatible but TS strict mode
  // disagrees on Symbol.toStringTag — convert via Uint8Array to satisfy exceljs typing
  await wb.xlsx.load(new Uint8Array(req.file.buffer).buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'EMPTY_WORKBOOK' });

  // Lee header (fila 1)
  const header: string[] = [];
  ws.getRow(1).eachCell((cell) => header.push(String(cell.value ?? '').trim().toLowerCase()));
  for (const col of ['nombre_completo', 'cedula', 'email']) {
    if (!header.includes(col)) return res.status(400).json({ error: 'MISSING_COLUMN', column: col });
  }
  const idx = (k: string) => header.indexOf(k) + 1;

  let inserted = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    try {
      const nombre = String(row.getCell(idx('nombre_completo')).value ?? '').trim();
      const cedulaRaw = String(row.getCell(idx('cedula')).value ?? '').trim();
      const cedula = cedulaRaw.replace(/[\s.\-]/g, '');
      const email = String(row.getCell(idx('email')).value ?? '').trim().toLowerCase();
      if (!nombre || !cedula || !email) continue;

      await supabaseAdmin.from('participantes_lista').upsert(
        {
          cohorte_id: cohorteId,
          nombre_completo: nombre,
          cedula_encriptada: encryptPII(cedula),
          cedula_hash: sha256Hex(cedula),
          email_encriptado: encryptPII(email),
          email_hash: sha256Hex(email),
          estado: 'pendiente_activacion',
        },
        { onConflict: 'cohorte_id,cedula_hash' },
      );
      inserted++;
    } catch (e) {
      errors.push({ row: r, error: (e as Error).message });
    }
  }

  res.json({ inserted, errors: errors.slice(0, 20) });
});

/**
 * POST /api/admin/cohortes/:id/actualizar-fechas
 * Body: { fecha_limite_formacion_equipos, fecha_limite_entrega_anteproyecto, fecha_reunion_1, fecha_limite_seleccion_definitivo }
 */
const fechasSchema = z.object({
  fecha_limite_formacion_equipos: z.string().datetime().optional(),
  fecha_limite_entrega_anteproyecto: z.string().datetime().optional(),
  fecha_reunion_1: z.string().datetime().optional(),
  fecha_limite_seleccion_definitivo: z.string().datetime().optional(),
});

router.post('/cohortes/:id/actualizar-fechas', async (req, res) => {
  const parsed = fechasSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { error } = await supabaseAdmin.from('cohortes').update(parsed.data).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
