import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth());

// === GET /api/participantes/mi-modalidad ====================================
router.get('/mi-modalidad', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const { data, error } = await supabaseAdmin
    .from('participantes_lista')
    .select('tipo_trabajo_grado, tipo_trabajo_grado_fijado_at')
    .eq('id', pid)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    tipo_trabajo_grado: data?.tipo_trabajo_grado ?? null,
    fijado_at: data?.tipo_trabajo_grado_fijado_at ?? null,
  });
});

// === PUT /api/participantes/mi-modalidad ====================================
const modalidadSchema = z.object({
  tipo: z.enum(['business_plan', 'caso', 'proyecto_investigacion']),
});

router.put('/mi-modalidad', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const parsed = modalidadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const { data: yo } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, tipo_trabajo_grado, estado')
    .eq('id', pid)
    .maybeSingle();
  if (!yo) return res.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
  if (yo.estado !== 'activo') return res.status(403).json({ error: 'PARTICIPANT_NOT_ACTIVE' });
  if (yo.tipo_trabajo_grado) {
    return res.status(409).json({ error: 'ALREADY_SET', tipo: yo.tipo_trabajo_grado });
  }

  const { error: upErr } = await supabaseAdmin
    .from('participantes_lista')
    .update({
      tipo_trabajo_grado: parsed.data.tipo,
      tipo_trabajo_grado_fijado_at: new Date().toISOString(),
    })
    .eq('id', pid)
    .is('tipo_trabajo_grado', null);
  if (upErr) return res.status(500).json({ error: upErr.message });

  res.json({ ok: true, tipo: parsed.data.tipo });
});

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
