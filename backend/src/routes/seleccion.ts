import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth());

async function fetchEquipoConCohorte(equipoId: string) {
  const { data, error } = await supabaseAdmin
    .from('equipos')
    .select(`
      id, cohorte_id, reunion_1_marcada_por, reunion_1_fecha_marcado, proyecto_definitivo_id,
      cohortes ( fecha_reunion_1, fecha_limite_seleccion_definitivo )
    `)
    .eq('id', equipoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// === POST /api/equipos/:id/marcar-reunion-1 ============================
router.post('/equipos/:id/marcar-reunion-1', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Verifica miembro
  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('id').eq('equipo_id', req.params.id).eq('participante_id', pid).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const equipo = await fetchEquipoConCohorte(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'TEAM_NOT_FOUND' });
  if (equipo.reunion_1_marcada_por) return res.status(409).json({ error: 'ALREADY_MARKED' });

  const fechas = equipo.cohortes as any;
  const ahora = new Date();
  if (fechas?.fecha_reunion_1 && ahora < new Date(fechas.fecha_reunion_1)) {
    return res.status(403).json({ error: 'TOO_EARLY', fecha_reunion_1: fechas.fecha_reunion_1 });
  }
  if (fechas?.fecha_limite_seleccion_definitivo && ahora > new Date(fechas.fecha_limite_seleccion_definitivo)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: fechas.fecha_limite_seleccion_definitivo });
  }

  // Solo aplica si tiene 2-3 proyectos
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos').select('id').eq('equipo_id', req.params.id).maybeSingle();
  if (!ant) return res.status(409).json({ error: 'NO_ANTEPROYECTO' });
  const { count } = await supabaseAdmin
    .from('proyectos').select('*', { count: 'exact', head: true }).eq('anteproyecto_id', ant.id);
  if ((count ?? 0) < 2) return res.status(409).json({ error: 'ONLY_ONE_PROJECT', mensaje: 'No aplica: con 1 proyecto se marca definitivo automáticamente al enviar.' });

  await supabaseAdmin
    .from('equipos')
    .update({ reunion_1_marcada_por: pid, reunion_1_fecha_marcado: ahora.toISOString() })
    .eq('id', req.params.id);

  res.json({
    reunion_1_marcada: true,
    fecha_marcado: ahora.toISOString(),
    siguiente_paso: 'seleccionar_proyecto_definitivo',
    fecha_limite_seleccion: fechas?.fecha_limite_seleccion_definitivo ?? null,
  });
});

// === POST /api/equipos/:id/seleccionar-proyecto-definitivo =============
const seleccionarSchema = z.object({ proyecto_id: z.string().uuid() });
router.post('/equipos/:id/seleccionar-proyecto-definitivo', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const parsed = seleccionarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Member?
  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('id').eq('equipo_id', req.params.id).eq('participante_id', pid).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const equipo = await fetchEquipoConCohorte(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'TEAM_NOT_FOUND' });
  if (!equipo.reunion_1_marcada_por) return res.status(412).json({ error: 'REUNION_1_NOT_MARKED' });
  if (equipo.proyecto_definitivo_id) return res.status(409).json({ error: 'ALREADY_SELECTED', proyecto_definitivo_id: equipo.proyecto_definitivo_id });

  const fechas = equipo.cohortes as any;
  if (fechas?.fecha_limite_seleccion_definitivo && new Date() > new Date(fechas.fecha_limite_seleccion_definitivo)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA' });
  }

  // El proyecto debe pertenecer al anteproyecto del equipo
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos').select('id, proyectos(id)').eq('equipo_id', req.params.id).maybeSingle();
  if (!ant) return res.status(409).json({ error: 'NO_ANTEPROYECTO' });
  const ids = ((ant.proyectos as any[]) ?? []).map((p) => p.id);
  if (!ids.includes(parsed.data.proyecto_id)) return res.status(400).json({ error: 'PROJECT_NOT_IN_TEAM' });

  const ahora = new Date().toISOString();
  // El proyecto elegido pasa a definitivo, los demás a archivado
  await supabaseAdmin.from('proyectos').update({ estado_seleccion: 'definitivo' }).eq('id', parsed.data.proyecto_id);
  await supabaseAdmin
    .from('proyectos')
    .update({ estado_seleccion: 'archivado', fecha_archivado: ahora })
    .eq('anteproyecto_id', ant.id)
    .neq('id', parsed.data.proyecto_id);
  await supabaseAdmin
    .from('equipos')
    .update({ proyecto_definitivo_id: parsed.data.proyecto_id, fecha_seleccion_definitivo: ahora })
    .eq('id', req.params.id);

  res.json({ ok: true, proyecto_definitivo_id: parsed.data.proyecto_id, archivados_count: ids.length - 1 });
});

// === POST /api/proyectos/:id/solicitar-desarchivar ====================
const desarchivarSchema = z.object({ motivo: z.string().min(20).max(2000) });
router.post('/proyectos/:id/solicitar-desarchivar', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const parsed = desarchivarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Verificar que el proyecto está archivado y pertenece al equipo del usuario
  const { data: proy } = await supabaseAdmin
    .from('proyectos')
    .select('id, estado_seleccion, anteproyecto_id, anteproyectos(equipo_id)')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!proy) return res.status(404).json({ error: 'NOT_FOUND' });
  if (proy.estado_seleccion !== 'archivado') return res.status(409).json({ error: 'NOT_ARCHIVED' });

  const equipoId = (proy.anteproyectos as any)?.equipo_id;
  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('id').eq('equipo_id', equipoId).eq('participante_id', pid).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const { data, error } = await supabaseAdmin
    .from('solicitudes_desarchivado')
    .insert({ proyecto_id: req.params.id, solicitante_id: pid, motivo: parsed.data.motivo, estado: 'pendiente' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ solicitud_id: data.id, estado: 'pendiente' });
});

// === POST /api/admin/solicitudes-desarchivado/:id/aprobar (profesor) ====
const respuestaSchema = z.object({ respuesta: z.string().min(1).max(2000).optional() });

router.post('/admin/solicitudes-desarchivado/:id/aprobar', requireRole('profesor'), async (req: AuthenticatedRequest, res) => {
  const parsed = respuestaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  const profId = req.user!.profesorId;
  if (!profId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  const { data: sol } = await supabaseAdmin
    .from('solicitudes_desarchivado').select('id, proyecto_id, estado').eq('id', req.params.id).maybeSingle();
  if (!sol) return res.status(404).json({ error: 'NOT_FOUND' });
  if (sol.estado !== 'pendiente') return res.status(409).json({ error: 'ALREADY_RESOLVED' });

  const ahora = new Date().toISOString();
  await supabaseAdmin.from('solicitudes_desarchivado').update({
    estado: 'aprobada', profesor_id: profId, respuesta_profesor: parsed.data.respuesta ?? null, fecha_respuesta: ahora,
  }).eq('id', req.params.id);

  await supabaseAdmin.from('proyectos').update({
    estado_seleccion: 'pendiente_seleccion',
    desarchivado: true, fecha_desarchivado: ahora, desarchivado_aprobado_por: profId,
  }).eq('id', sol.proyecto_id);

  res.json({ ok: true });
});

router.post('/admin/solicitudes-desarchivado/:id/rechazar', requireRole('profesor'), async (req: AuthenticatedRequest, res) => {
  const parsed = respuestaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  const profId = req.user!.profesorId;
  if (!profId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  const { data: sol } = await supabaseAdmin
    .from('solicitudes_desarchivado').select('id, estado').eq('id', req.params.id).maybeSingle();
  if (!sol) return res.status(404).json({ error: 'NOT_FOUND' });
  if (sol.estado !== 'pendiente') return res.status(409).json({ error: 'ALREADY_RESOLVED' });

  await supabaseAdmin.from('solicitudes_desarchivado').update({
    estado: 'rechazada', profesor_id: profId, respuesta_profesor: parsed.data.respuesta ?? null, fecha_respuesta: new Date().toISOString(),
  }).eq('id', req.params.id);

  res.json({ ok: true });
});

export default router;
