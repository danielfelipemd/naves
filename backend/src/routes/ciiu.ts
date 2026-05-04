import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

router.get('/buscar', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);

  // Si es código (4 dígitos) busca exacto, sino full-text
  if (/^\d{1,4}$/.test(q)) {
    const { data, error } = await supabaseAdmin
      .from('codigos_ciiu')
      .select('codigo, descripcion, seccion')
      .ilike('codigo', `${q}%`)
      .eq('activo', true)
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data ?? []);
  }

  const { data, error } = await supabaseAdmin
    .from('codigos_ciiu')
    .select('codigo, descripcion, seccion')
    .textSearch('descripcion', q, { config: 'spanish', type: 'websearch' })
    .eq('activo', true)
    .limit(20);
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
