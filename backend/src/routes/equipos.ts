import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth(), requireRole('participante'));

// === Helpers =====================================================
async function getCohorteFechas(cohorteId: string) {
  const { data } = await supabaseAdmin
    .from('cohortes')
    .select('fecha_limite_formacion_equipos, fecha_limite_entrega_anteproyecto, fecha_reunion_1, fecha_limite_seleccion_definitivo')
    .eq('id', cohorteId)
    .maybeSingle();
  return data;
}

function dentroDePlazo(deadline: string | null | undefined): boolean {
  if (!deadline) return true; // si no hay fecha definida, no bloqueamos
  return new Date() < new Date(deadline);
}

async function meAndCohorte(participanteId: string) {
  const { data, error } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, cohorte_id, nombre_completo, estado, tipo_trabajo_grado')
    .eq('id', participanteId)
    .maybeSingle();
  if (error || !data) throw new Error('PARTICIPANT_NOT_FOUND');
  if (data.estado !== 'activo') throw new Error('PARTICIPANT_NOT_ACTIVE');
  return data;
}

// === GET /api/equipos/mi-equipo =================================
router.get('/mi-equipo', async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const { data: miembro } = await supabaseAdmin
    .from('miembros_equipo')
    .select('equipo_id')
    .eq('participante_id', pid)
    .maybeSingle();

  if (!miembro) return res.json({ equipo: null });

  const { data: equipo, error } = await supabaseAdmin
    .from('equipos')
    .select(`
      *,
      miembros_equipo (
        id, posicion, fue_emprendedor, quiebra, aprendizajes_quiebra, perfil,
        participantes_lista ( id, nombre_completo )
      )
    `)
    .eq('id', miembro.equipo_id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ equipo });
});

/**
 * Copia el perfil emprendedor del participante a su fila en miembros_equipo.
 * Se invoca al crear equipo (con el creador) y al agregar miembros.
 */
async function copyPerfilParticipanteAMiembro(participanteId: string, miembroId: string): Promise<void> {
  const { data: p } = await supabaseAdmin
    .from('participantes_lista')
    .select('perfil, fue_emprendedor, quiebra, aprendizajes_quiebra')
    .eq('id', participanteId)
    .maybeSingle();
  if (!p?.perfil) return; // todavía no llenó perfil → no copiar
  await supabaseAdmin.from('miembros_equipo').update({
    perfil: p.perfil,
    fue_emprendedor: p.fue_emprendedor,
    quiebra: p.quiebra,
    aprendizajes_quiebra: p.aprendizajes_quiebra,
  }).eq('id', miembroId);
  const [{ data: ems }, { data: prs }] = await Promise.all([
    supabaseAdmin.from('participante_emociones').select('emocion').eq('participante_id', participanteId),
    supabaseAdmin.from('participante_preocupaciones').select('preocupacion').eq('participante_id', participanteId),
  ]);
  await supabaseAdmin.from('miembro_emociones').delete().eq('miembro_id', miembroId);
  await supabaseAdmin.from('miembro_preocupaciones').delete().eq('miembro_id', miembroId);
  if (ems?.length) {
    await supabaseAdmin.from('miembro_emociones').insert(ems.map((e: any) => ({ miembro_id: miembroId, emocion: e.emocion })));
  }
  if (prs?.length) {
    await supabaseAdmin.from('miembro_preocupaciones').insert(prs.map((x: any) => ({ miembro_id: miembroId, preocupacion: x.preocupacion })));
  }
}

// === POST /api/equipos =================================
const createSchema = z.object({
  nombre_equipo: z.string().trim().max(100).optional(),
});
router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  try {
    const me = await meAndCohorte(pid);
    if (!me.tipo_trabajo_grado) {
      return res.status(400).json({ error: 'MODALIDAD_NO_DEFINIDA', mensaje: 'Debes elegir tu modalidad de trabajo de grado antes de crear un equipo.' });
    }
    // business_plan exige tener el perfil emprendedor lleno
    if (me.tipo_trabajo_grado === 'business_plan') {
      const { data: perfil } = await supabaseAdmin
        .from('participantes_lista').select('perfil_completo_at').eq('id', pid).maybeSingle();
      if (!perfil?.perfil_completo_at) {
        return res.status(400).json({ error: 'PERFIL_NO_COMPLETO', mensaje: 'Debes completar tu perfil emprendedor antes de crear un equipo.' });
      }
    }
    const fechas = await getCohorteFechas(me.cohorte_id);
    if (!dentroDePlazo(fechas?.fecha_limite_formacion_equipos)) {
      return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', mensaje: 'La fecha límite para formar equipos ya pasó.' });
    }

    // ¿ya está en otro equipo?
    const { data: existing } = await supabaseAdmin
      .from('miembros_equipo').select('equipo_id').eq('participante_id', pid).maybeSingle();
    if (existing) return res.status(409).json({ error: 'ALREADY_IN_TEAM', equipo_id: existing.equipo_id });

    // Crear equipo
    const { data: equipo, error: e1 } = await supabaseAdmin
      .from('equipos')
      .insert({
        cohorte_id: me.cohorte_id,
        creador_id: pid,
        nombre_equipo: parsed.data.nombre_equipo ?? null,
        tipo_trabajo_grado: me.tipo_trabajo_grado,
      })
      .select().single();
    if (e1) throw e1;

    // Inscribir creador como miembro 1
    const { data: miembroCreador, error: e2 } = await supabaseAdmin
      .from('miembros_equipo')
      .insert({ equipo_id: equipo.id, participante_id: pid, posicion: 1 })
      .select('id').single();
    if (e2) throw e2;
    if (miembroCreador) await copyPerfilParticipanteAMiembro(pid, miembroCreador.id);

    // Crear anteproyecto en borrador
    await supabaseAdmin.from('anteproyectos').insert({ equipo_id: equipo.id, ultimo_editor_id: pid });

    res.status(201).json({ equipo });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'CREATE_FAILED' });
  }
});

// === POST /api/equipos/:id/agregar-miembro =================================
const addMemberSchema = z.object({
  participante_id: z.string().uuid(),
  posicion: z.number().int().min(2).max(3),
});
router.post('/:id/agregar-miembro', async (req: AuthenticatedRequest, res) => {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Soy miembro del equipo?
  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('equipo_id').eq('participante_id', pid).eq('equipo_id', req.params.id).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  // Equipo y plazo
  const { data: equipo } = await supabaseAdmin
    .from('equipos')
    .select('cohorte_id, tipo_trabajo_grado')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!equipo) return res.status(404).json({ error: 'TEAM_NOT_FOUND' });
  const fechas = await getCohorteFechas(equipo.cohorte_id);
  if (!dentroDePlazo(fechas?.fecha_limite_formacion_equipos)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA' });
  }

  // El nuevo miembro debe ser de la misma cohorte, no estar en otro equipo y compartir modalidad
  const { data: target } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, cohorte_id, estado, tipo_trabajo_grado')
    .eq('id', parsed.data.participante_id)
    .maybeSingle();
  if (!target) return res.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
  if (target.cohorte_id !== equipo.cohorte_id) return res.status(400).json({ error: 'COHORTE_MISMATCH' });
  if (!target.tipo_trabajo_grado) return res.status(400).json({ error: 'TARGET_SIN_MODALIDAD' });
  if (target.tipo_trabajo_grado !== equipo.tipo_trabajo_grado) {
    return res.status(400).json({
      error: 'MODALIDAD_MISMATCH',
      equipo: equipo.tipo_trabajo_grado,
      target: target.tipo_trabajo_grado,
    });
  }

  // business_plan: target debe haber completado su perfil emprendedor
  if (equipo.tipo_trabajo_grado === 'business_plan') {
    const { data: tgtPerfil } = await supabaseAdmin
      .from('participantes_lista').select('perfil_completo_at').eq('id', target.id).maybeSingle();
    if (!tgtPerfil?.perfil_completo_at) {
      return res.status(400).json({
        error: 'TARGET_PERFIL_NO_COMPLETO',
        mensaje: 'Ese compañero todavía no ha completado su perfil emprendedor.',
      });
    }
  }

  const { data: alreadyIn } = await supabaseAdmin
    .from('miembros_equipo').select('equipo_id').eq('participante_id', target.id).maybeSingle();
  if (alreadyIn) return res.status(409).json({ error: 'ALREADY_IN_TEAM', equipo_id: alreadyIn.equipo_id });

  // Posición ocupada?
  const { count: posCount } = await supabaseAdmin
    .from('miembros_equipo').select('*', { count: 'exact', head: true })
    .eq('equipo_id', req.params.id).eq('posicion', parsed.data.posicion);
  if ((posCount ?? 0) > 0) return res.status(409).json({ error: 'POSITION_TAKEN' });

  const { data, error } = await supabaseAdmin
    .from('miembros_equipo')
    .insert({ equipo_id: req.params.id, participante_id: target.id, posicion: parsed.data.posicion })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (data) await copyPerfilParticipanteAMiembro(target.id, data.id);

  res.status(201).json({ miembro: data });
});

// === POST /api/equipos/:id/remover-miembro =================================
const removeSchema = z.object({ participante_id: z.string().uuid() });
router.post('/:id/remover-miembro', async (req: AuthenticatedRequest, res) => {
  const parsed = removeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('equipo_id').eq('participante_id', pid).eq('equipo_id', req.params.id).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  // No puedes removerte a ti mismo si eres el creador (debería disolver el equipo, lo dejamos para más adelante)
  const { data: equipo } = await supabaseAdmin.from('equipos').select('creador_id, cohorte_id').eq('id', req.params.id).maybeSingle();
  if (!equipo) return res.status(404).json({ error: 'TEAM_NOT_FOUND' });
  if (equipo.creador_id === parsed.data.participante_id) return res.status(400).json({ error: 'CANNOT_REMOVE_CREATOR' });

  const fechas = await getCohorteFechas(equipo.cohorte_id);
  if (!dentroDePlazo(fechas?.fecha_limite_formacion_equipos)) return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA' });

  const { error } = await supabaseAdmin
    .from('miembros_equipo')
    .delete()
    .eq('equipo_id', req.params.id)
    .eq('participante_id', parsed.data.participante_id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

export default router;
