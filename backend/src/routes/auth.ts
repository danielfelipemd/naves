import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { sha256Hex, syntheticEmailFromCedula } from '../auth/crypto.js';

const router = Router();

const verificarCedulaSchema = z.object({
  cedula: z.string().min(6).max(20).regex(/^\d+$/, 'Solo dígitos'),
});

// Verifica si la cédula está pre-cargada y devuelve el estado
router.post('/verificar-cedula', async (req, res) => {
  const parsed = verificarCedulaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const cedulaClean = parsed.data.cedula.replace(/[\s.\-]/g, '');
  const cedulaHash = sha256Hex(cedulaClean);

  const { data, error } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, estado, nombre_completo, cohorte_id')
    .eq('cedula_hash', cedulaHash)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'DB_ERROR', message: error.message });
  if (!data) return res.status(404).json({ error: 'CEDULA_NO_ENCONTRADA' });

  res.json({
    estado: data.estado,
    nombre: data.nombre_completo,
    cohorte: data.cohorte_id,
    sintheticEmail: syntheticEmailFromCedula(cedulaClean),
  });
});

// Health del módulo auth
router.get('/', (_req, res) => res.json({ module: 'auth', status: 'ok' }));

export default router;
