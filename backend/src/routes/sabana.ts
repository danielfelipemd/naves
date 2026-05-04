import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth());

/**
 * POST /api/sabana/:cohorteId/generar
 * Solo super_admin. Construye snapshot consolidado de todos los proyectos de la cohorte.
 */
router.post('/:cohorteId/generar', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const { cohorteId } = req.params;
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  const { data: equipos, error } = await supabaseAdmin
    .from('equipos')
    .select(`
      id, nombre_equipo,
      miembros_equipo (
        posicion, participante_id,
        participantes_lista ( nombre_completo )
      ),
      anteproyectos (
        id, estado,
        proyectos ( id, nombre, sector, ciiu, tipo, estado_seleccion, canvas_cliente_problema )
      )
    `)
    .eq('cohorte_id', cohorteId);
  if (error) return res.status(500).json({ error: error.message });

  type Snap = {
    equipo_id: string;
    equipo_nombre: string | null;
    proyecto_id: string;
    proyecto_nombre: string;
    sector: string | null;
    ciiu: string | null;
    tipo: string | null;
    estado_seleccion: string | null;
    resumen: string;
    miembros: Array<{ nombre: string; posicion: number }>;
  };

  const snapshot: Snap[] = [];
  for (const eq of equipos ?? []) {
    const ant = (eq.anteproyectos as any[])?.[0];
    if (!ant || ant.estado !== 'enviado') continue;
    for (const p of (ant.proyectos as any[]) ?? []) {
      snapshot.push({
        equipo_id: eq.id,
        equipo_nombre: eq.nombre_equipo,
        proyecto_id: p.id,
        proyecto_nombre: p.nombre,
        sector: p.sector,
        ciiu: p.ciiu,
        tipo: p.tipo,
        estado_seleccion: p.estado_seleccion,
        resumen: (p.canvas_cliente_problema ?? '').slice(0, 300),
        miembros: ((eq.miembros_equipo as any[]) ?? []).map((m) => ({
          nombre: m.participantes_lista?.nombre_completo ?? '',
          posicion: m.posicion,
        })),
      });
    }
  }

  await supabaseAdmin
    .from('sabanas_proyectos')
    .upsert({ cohorte_id: cohorteId, estado: 'generada', snapshot }, { onConflict: 'cohorte_id' });

  res.json({ cohorte_id: cohorteId, proyectos: snapshot.length, snapshot });
});

/**
 * POST /api/sabana/:cohorteId/sugerir-asignacion
 * Empareja proyectos definitivos con profesores según afinidad sector/CIIU.
 */
router.post('/:cohorteId/sugerir-asignacion', requireRole('super_admin'), async (req, res) => {
  const { cohorteId } = req.params;
  const [{ data: profesores }, { data: sabana }] = await Promise.all([
    supabaseAdmin.from('profesores').select('id, nombre_completo, areas_afinidad').eq('activo', true),
    supabaseAdmin.from('sabanas_proyectos').select('snapshot').eq('cohorte_id', cohorteId).maybeSingle(),
  ]);

  if (!sabana) return res.status(404).json({ error: 'SABANA_NOT_FOUND' });

  const sugerencias: Array<{ equipo_id: string; top: Array<{ profesor_id: string; nombre: string; score: number }> }> = [];
  for (const p of (sabana.snapshot as any[]) ?? []) {
    if (p.estado_seleccion !== 'definitivo') continue;
    const scored = (profesores ?? []).map((prof) => {
      const afinidad: string[] = prof.areas_afinidad ?? [];
      const score = afinidad.reduce((acc, a) => {
        const al = a.toLowerCase();
        if (p.sector && al && p.sector.toLowerCase().includes(al)) acc++;
        if (p.ciiu && a === p.ciiu) acc++;
        return acc;
      }, 0);
      return { profesor_id: prof.id, nombre: prof.nombre_completo, score };
    });
    scored.sort((a, b) => b.score - a.score);
    sugerencias.push({ equipo_id: p.equipo_id, top: scored.slice(0, 3) });
  }

  await supabaseAdmin.from('sabanas_proyectos').update({ sugerencias }).eq('cohorte_id', cohorteId);
  res.json({ sugerencias });
});

/**
 * GET /api/sabana/:cohorteId
 * Profesores y super_admin pueden leer.
 */
router.get('/:cohorteId', requireRole('profesor', 'super_admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('sabanas_proyectos')
    .select('*')
    .eq('cohorte_id', req.params.cohorteId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(data);
});

export default router;
