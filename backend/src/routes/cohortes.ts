import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth());

/**
 * GET /api/cohortes/mi-cohorte
 * Devuelve la cohorte del participante o profesor logueado.
 * Datos públicos para usuarios autenticados (etiqueta + fechas del programa + fechas del Scheduler).
 */
router.get('/mi-cohorte', async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.user?.cohorteId;
  if (!cohorteId) return res.json({ cohorte: null });

  const { data, error } = await supabaseAdmin
    .from('cohortes')
    .select('id, etiqueta, fecha_inicio, fecha_fin, fecha_limite_formacion_equipos, fecha_limite_entrega_anteproyecto, fecha_reunion_1, fecha_limite_seleccion_definitivo, activa')
    .eq('id', cohorteId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ cohorte: data });
});

/**
 * GET /api/cohortes/:id  (solo metadatos básicos para usuarios autenticados)
 */
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('cohortes')
    .select('id, etiqueta, fecha_inicio, fecha_fin, activa')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(data);
});

export default router;
