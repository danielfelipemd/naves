import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth());

/**
 * GET /api/participantes/buscar?cohorte=int-26-28&query=juan
 * Devuelve participantes activos de la cohorte que NO están ya en un equipo.
 */
const buscarSchema = z.object({
  cohorte: z.string().min(1),
  query: z.string().trim().max(80).optional(),
});

router.get('/buscar', async (req: AuthenticatedRequest, res) => {
  const parsed = buscarSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  // Solo la misma cohorte que el usuario logueado (o staff)
  if (req.user!.role === 'participante' && req.user!.cohorteId && req.user!.cohorteId !== parsed.data.cohorte) {
    return res.status(403).json({ error: 'COHORTE_MISMATCH' });
  }

  // Subquery: participantes que YA están en un equipo
  const { data: enEquipos } = await supabaseAdmin.from('miembros_equipo').select('participante_id');
  const idsOcupados = new Set((enEquipos ?? []).map((m) => m.participante_id));

  let q = supabaseAdmin
    .from('participantes_lista')
    .select('id, nombre_completo, cohorte_id, estado')
    .eq('cohorte_id', parsed.data.cohorte)
    .eq('estado', 'activo');

  if (parsed.data.query) {
    q = q.ilike('nombre_completo', `%${parsed.data.query}%`);
  }

  const { data, error } = await q.limit(30);
  if (error) return res.status(500).json({ error: error.message });

  const disponibles = (data ?? []).filter((p) => !idsOcupados.has(p.id));
  res.json(disponibles.map((p) => ({ id: p.id, nombre_completo: p.nombre_completo })));
});

export default router;
