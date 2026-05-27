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

// === PUT /api/participantes/esperar-equipo ==================================
// El participante declara que NO va a crear equipo; espera a ser agregado.
// Su Dashboard quedara bloqueado con un mensaje hasta que alguien lo agregue
// (lo que limpia el flag automaticamente).
router.put('/esperar-equipo', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Si ya esta en un equipo, no tiene sentido el estado de espera
  const { data: yaEnEq } = await supabaseAdmin
    .from('miembros_equipo').select('equipo_id').eq('participante_id', pid).maybeSingle();
  if (yaEnEq) return res.status(409).json({ error: 'YA_EN_EQUIPO' });

  const { error } = await supabaseAdmin
    .from('participantes_lista')
    .update({ esperando_equipo_at: new Date().toISOString() })
    .eq('id', pid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// === PUT /api/participantes/cancelar-espera =================================
// El participante cambia de opinion y decide crear su propio equipo.
router.put('/cancelar-espera', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });
  const { error } = await supabaseAdmin
    .from('participantes_lista')
    .update({ esperando_equipo_at: null })
    .eq('id', pid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// === GET /api/participantes/mi-perfil =======================================
// Devuelve el perfil emprendedor del participante logueado (modalidad business_plan)
router.get('/mi-perfil', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const { data, error } = await supabaseAdmin
    .from('participantes_lista')
    .select('perfil, fue_emprendedor, quiebra, aprendizajes_quiebra, perfil_completo_at')
    .eq('id', pid)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  const [{ data: ems }, { data: prs }] = await Promise.all([
    supabaseAdmin.from('participante_emociones').select('emocion').eq('participante_id', pid),
    supabaseAdmin.from('participante_preocupaciones').select('preocupacion').eq('participante_id', pid),
  ]);

  res.json({
    perfil: data?.perfil ?? null,
    fue_emprendedor: data?.fue_emprendedor ?? null,
    quiebra: data?.quiebra ?? null,
    aprendizajes_quiebra: data?.aprendizajes_quiebra ?? '',
    emociones: (ems ?? []).map((e: any) => e.emocion),
    preocupaciones: (prs ?? []).map((p: any) => p.preocupacion),
    perfil_completo_at: data?.perfil_completo_at ?? null,
  });
});

// === PUT /api/participantes/mi-perfil =======================================
const perfilSchema = z.object({
  perfil: z.enum(['emprendedor', 'directivo', 'ambos']),
  fue_emprendedor: z.boolean(),
  quiebra: z.enum(['nunca_despego', 'funcionamiento', 'vendido', 'quebro', 'na']).optional(),
  aprendizajes_quiebra: z.string().max(200).optional(),
  emociones: z.array(z.enum(['crear', 'dinero', 'problema', 'autonomia', 'ninguna'])).min(1),
  preocupaciones: z.array(z.enum(['financiera', 'estres', 'habilidades', 'familia', 'ninguna'])).min(1),
});

router.put('/mi-perfil', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const parsed = perfilSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const datos = parsed.data;
  const { error: upErr } = await supabaseAdmin
    .from('participantes_lista')
    .update({
      perfil: datos.perfil,
      fue_emprendedor: datos.fue_emprendedor,
      quiebra: datos.fue_emprendedor ? (datos.quiebra ?? null) : null,
      aprendizajes_quiebra: datos.fue_emprendedor && datos.quiebra === 'quebro' ? (datos.aprendizajes_quiebra ?? null) : null,
      perfil_completo_at: new Date().toISOString(),
    })
    .eq('id', pid);
  if (upErr) return res.status(500).json({ error: upErr.message });

  // Reemplazar emociones y preocupaciones
  await supabaseAdmin.from('participante_emociones').delete().eq('participante_id', pid);
  await supabaseAdmin.from('participante_preocupaciones').delete().eq('participante_id', pid);
  if (datos.emociones.length) {
    await supabaseAdmin.from('participante_emociones').insert(datos.emociones.map((e) => ({ participante_id: pid, emocion: e })));
  }
  if (datos.preocupaciones.length) {
    await supabaseAdmin.from('participante_preocupaciones').insert(datos.preocupaciones.map((p) => ({ participante_id: pid, preocupacion: p })));
  }

  // Sincronizar a miembros_equipo si ya está en un equipo (para que el flujo viejo siga viendo el perfil)
  const { data: miembros } = await supabaseAdmin
    .from('miembros_equipo').select('id').eq('participante_id', pid);
  for (const m of miembros ?? []) {
    await supabaseAdmin.from('miembros_equipo').update({
      perfil: datos.perfil,
      fue_emprendedor: datos.fue_emprendedor,
      quiebra: datos.fue_emprendedor ? (datos.quiebra ?? null) : null,
      aprendizajes_quiebra: datos.fue_emprendedor && datos.quiebra === 'quebro' ? (datos.aprendizajes_quiebra ?? null) : null,
    }).eq('id', m.id);
    await supabaseAdmin.from('miembro_emociones').delete().eq('miembro_id', m.id);
    await supabaseAdmin.from('miembro_preocupaciones').delete().eq('miembro_id', m.id);
    if (datos.emociones.length) {
      await supabaseAdmin.from('miembro_emociones').insert(datos.emociones.map((e) => ({ miembro_id: m.id, emocion: e })));
    }
    if (datos.preocupaciones.length) {
      await supabaseAdmin.from('miembro_preocupaciones').insert(datos.preocupaciones.map((p) => ({ miembro_id: m.id, preocupacion: p })));
    }
  }

  res.json({ ok: true });
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

  // Si el caller es participante, derivamos su modalidad para filtrar la lista
  // a quienes comparten la misma modalidad y excluirlo a el mismo.
  let modalidadCaller: string | null = null;
  let callerId: string | null = null;
  if (req.user!.role === 'participante' && req.user!.participanteId) {
    callerId = req.user!.participanteId;
    const { data: yo } = await supabaseAdmin
      .from('participantes_lista').select('tipo_trabajo_grado').eq('id', callerId).maybeSingle();
    modalidadCaller = (yo?.tipo_trabajo_grado as string | null) ?? null;
  }

  // Subquery: participantes que YA están en un equipo
  const { data: enEquipos } = await supabaseAdmin.from('miembros_equipo').select('participante_id');
  const idsOcupados = new Set((enEquipos ?? []).map((m) => m.participante_id));

  let q = supabaseAdmin
    .from('participantes_lista')
    .select('id, nombre_completo, cohorte_id, estado, tipo_trabajo_grado, perfil_completo_at')
    .eq('cohorte_id', parsed.data.cohorte)
    .eq('estado', 'activo');

  if (modalidadCaller) {
    q = q.eq('tipo_trabajo_grado', modalidadCaller);
  }

  if (parsed.data.query) {
    q = q.ilike('nombre_completo', `%${parsed.data.query}%`);
  }

  const { data, error } = await q.order('nombre_completo').limit(200);
  if (error) return res.status(500).json({ error: error.message });

  const disponibles = (data ?? []).filter((p) => !idsOcupados.has(p.id) && p.id !== callerId);
  res.json(disponibles.map((p) => ({
    id: p.id,
    nombre_completo: p.nombre_completo,
    perfil_completo: !!p.perfil_completo_at,
  })));
});

export default router;
