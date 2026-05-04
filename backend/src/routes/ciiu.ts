import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

router.get('/buscar', async (req, res) => {
  const parsed = querySchema.safeParse({ q: req.query.q, limit: req.query.limit });
  if (!parsed.success) return res.json([]);

  const { q, limit } = parsed.data;
  const { data, error } = await supabaseAdmin.rpc('buscar_ciiu', { q, lim: limit });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

router.get('/:codigo', async (req, res) => {
  const codigoSchema = z.string().regex(/^\d{4}$/);
  const codigo = codigoSchema.safeParse(req.params.codigo);
  if (!codigo.success) return res.status(400).json({ error: 'INVALID_CODE' });

  const { data, error } = await supabaseAdmin
    .from('codigos_ciiu')
    .select('codigo, descripcion, seccion, division, grupo')
    .eq('codigo', codigo.data)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(data);
});

export default router;
