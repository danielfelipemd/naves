import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { buildSabanaPDF } from '../services/pdf.js';

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
        proyectos ( id, nombre, sector, ciiu, tipo, estado_seleccion, canvas_cliente, canvas_problema, canvas_solucion )
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
        resumen: [
          p.canvas_cliente && `Cliente: ${p.canvas_cliente}`,
          p.canvas_problema && `Problema: ${p.canvas_problema}`,
          p.canvas_solucion && `Solución: ${p.canvas_solucion}`,
        ].filter(Boolean).join(' · ').slice(0, 500),
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

/**
 * GET /api/sabana/:cohorteId/resumen
 * Tabla resumen tipo Base de Datos: una fila por proyecto (BP) o por
 * equipo (caso/PI). Vista para profesor (filtrada a sus equipos) y
 * super_admin (toda la cohorte).
 */
router.get('/:cohorteId/resumen', requireRole('profesor', 'super_admin'), async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.params.cohorteId;
  const isSuperAdmin = !!req.user!.isSuperAdmin;
  const profesorId = req.user!.profesorId;
  if (!isSuperAdmin && !profesorId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  // Equipos de la cohorte con miembros, anteproyecto+proyectos, asignacion de profesor
  const { data: equipos, error } = await supabaseAdmin
    .from('equipos')
    .select(`
      id, nombre_equipo, tipo_trabajo_grado, buscando_socios, buscando_asociacion_otro_proyecto,
      miembros_equipo (
        posicion,
        participantes_lista ( nombre_completo )
      ),
      anteproyectos (
        id, estado,
        proyectos ( id, posicion, nombre, sector, tipo, estado_seleccion )
      ),
      asignaciones_profesor (
        profesores ( id, nombre_completo )
      ),
      directores ( id, nombre_completo )
    `)
    .eq('cohorte_id', cohorteId);
  if (error) return res.status(500).json({ error: error.message });

  type Fila = {
    numero: number;
    equipo_id: string;
    proyecto_id: string | null;
    nombre_proyecto: string;
    autores: string;
    sector: string | null;
    modalidad: string;
    buscando_socios: boolean | null;
    buscando_asociacion: boolean | null;
    profesor_asignado: string | null;
    director_asignado: string | null;
  };
  const filas: Fila[] = [];

  for (const eq of (equipos as any[]) ?? []) {
    // Filtrado para profesor: solo equipos donde es asignado (BP) o donde es director (caso/PI)
    if (!isSuperAdmin) {
      const profesorMatch = (eq.asignaciones_profesor ?? []).some((a: any) => a.profesores?.id === profesorId);
      if (!profesorMatch) continue;
    }

    const miembros = ((eq.miembros_equipo as any[]) ?? [])
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
      .map((m) => m.participantes_lista?.nombre_completo)
      .filter(Boolean);
    const autores = miembros.join(', ');
    const modalidad = eq.tipo_trabajo_grado as string;
    const profesorNombre = ((eq.asignaciones_profesor as any[]) ?? [])[0]?.profesores?.nombre_completo ?? null;
    const directorNombre = (eq.directores as any)?.nombre_completo ?? null;

    if (modalidad === 'business_plan') {
      const ant = (eq.anteproyectos as any[])?.[0];
      const proys = ((ant?.proyectos ?? []) as any[])
        .filter((p) => p.estado_seleccion !== 'archivado')
        .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0));
      if (proys.length === 0) {
        filas.push({
          numero: 0,
          equipo_id: eq.id,
          proyecto_id: null,
          nombre_proyecto: eq.nombre_equipo || '(sin nombre)',
          autores,
          sector: null,
          modalidad,
          buscando_socios: eq.buscando_socios ?? null,
          buscando_asociacion: eq.buscando_asociacion_otro_proyecto ?? null,
          profesor_asignado: profesorNombre,
          director_asignado: null,
        });
      } else {
        for (const p of proys) {
          filas.push({
            numero: 0,
            equipo_id: eq.id,
            proyecto_id: p.id,
            nombre_proyecto: p.nombre || '(sin nombre)',
            autores,
            sector: p.sector ?? null,
            modalidad,
            buscando_socios: eq.buscando_socios ?? null,
            buscando_asociacion: eq.buscando_asociacion_otro_proyecto ?? null,
            profesor_asignado: profesorNombre,
            director_asignado: null,
          });
        }
      }
    } else {
      // Caso / Proyecto de investigacion -> 1 fila por equipo
      filas.push({
        numero: 0,
        equipo_id: eq.id,
        proyecto_id: null,
        nombre_proyecto: eq.nombre_equipo || '(sin nombre)',
        autores,
        sector: null,
        modalidad,
        buscando_socios: eq.buscando_socios ?? null,
        buscando_asociacion: eq.buscando_asociacion_otro_proyecto ?? null,
        profesor_asignado: null,
        director_asignado: directorNombre,
      });
    }
  }

  // Numerar despues de filtrar/aplanar
  filas.forEach((f, i) => { f.numero = i + 1; });

  res.json({ cohorte_id: cohorteId, total: filas.length, filas });
});

/**
 * GET /api/sabana/:cohorteId/pdf
 */
router.get('/:cohorteId/pdf', requireRole('profesor', 'super_admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('sabanas_proyectos')
    .select('snapshot')
    .eq('cohorte_id', req.params.cohorteId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.snapshot) return res.status(404).json({ error: 'SABANA_NOT_GENERATED' });

  const pdf = await buildSabanaPDF(req.params.cohorteId, data.snapshot as any);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="sabana-${req.params.cohorteId}.pdf"`);
  res.send(pdf);
});

export default router;
