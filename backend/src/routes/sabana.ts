import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { buildSabanaPDF } from '../services/pdf.js';

const router = Router();
router.use(requireAuth());

// PostgREST devuelve la relacion equipos -> anteproyectos como OBJETO (no
// array) porque anteproyectos.equipo_id es UNIQUE (relacion 1:1). El codigo
// historico esperaba array; aceptamos ambas formas para no depender de
// como infiera PostgREST la cardinalidad.
function pickAnteproyecto(raw: unknown): any | undefined {
  if (!raw) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

type SnapEntry = {
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

/**
 * Regenera el snapshot de la sabana para una cohorte. Lo invocan tanto
 * el POST /:cohorteId/generar (admin manual) como POST /anteproyectos/:id/enviar
 * (automatico al enviar un anteproyecto, para que la sabana este al dia
 * sin que el admin tenga que tocar nada).
 */
export async function regenerarSabana(cohorteId: string): Promise<{ ok: true; proyectos: number } | { ok: false; error: string }> {
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
  if (error) return { ok: false, error: error.message };

  const snapshot: SnapEntry[] = [];
  for (const eq of equipos ?? []) {
    const ant = pickAnteproyecto(eq.anteproyectos);
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

  const { error: upErr } = await supabaseAdmin
    .from('sabanas_proyectos')
    .upsert({ cohorte_id: cohorteId, estado: 'generada', snapshot }, { onConflict: 'cohorte_id' });
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, proyectos: snapshot.length };
}

/**
 * POST /api/sabana/:cohorteId/generar
 * Solo super_admin. Construye snapshot consolidado de todos los proyectos de la cohorte.
 * Tambien se invoca automaticamente al enviar un anteproyecto (ver regenerarSabana).
 */
router.post('/:cohorteId/generar', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const { cohorteId } = req.params;
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  const result = await regenerarSabana(cohorteId);
  if (!result.ok) return res.status(500).json({ error: result.error });

  res.json({ cohorte_id: cohorteId, proyectos: result.proyectos });
});

/**
 * POST /api/sabana/:cohorteId/sugerir-asignacion
 * Empareja proyectos definitivos con profesores según afinidad sector/CIIU.
 */
router.post('/:cohorteId/sugerir-asignacion', requireRole('super_admin'), async (req, res) => {
  const { cohorteId } = req.params;
  const [{ data: profesores }, { data: sabana }] = await Promise.all([
    // tipo='profesor': el staff de área (marketing, operaciones, asistente de
    // programa) vive en esta misma tabla para reutilizar el login, pero no
    // dirige trabajos de grado y no puede aparecer como director asignable.
    supabaseAdmin.from('profesores').select('id, nombre_completo, areas_afinidad').eq('activo', true).eq('tipo', 'profesor'),
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
 * GET /api/sabana/buscando-socios
 * Vista de SOLO LECTURA para el participante: lista los equipos de SU cohorte
 * que están buscando socios, con su(s) proyecto(s). No expone asignaciones de
 * profesor ni nada editable. Debe ir ANTES de GET /:cohorteId para que la ruta
 * no la capture como cohorteId="buscando-socios".
 */
router.get('/buscando-socios', async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.user!.cohorteId || String(req.query.cohorte ?? '').trim();
  if (!cohorteId) return res.status(400).json({ error: 'NO_COHORTE' });

  const { data: equipos, error } = await supabaseAdmin
    .from('equipos')
    .select(`
      id, nombre_equipo,
      miembros_equipo ( posicion, participantes_lista ( nombre_completo ) ),
      anteproyectos ( estado, proyectos ( id, posicion, nombre, sector, ciiu, canvas_problema, canvas_solucion, estado_seleccion ) )
    `)
    .eq('cohorte_id', cohorteId)
    .eq('buscando_socios', true);
  if (error) return res.status(500).json({ error: error.message });

  const filas = ((equipos as any[]) ?? []).map((eq) => {
    const autores = ((eq.miembros_equipo as any[]) ?? [])
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
      .map((m) => m.participantes_lista?.nombre_completo)
      .filter(Boolean)
      .join(', ');
    const ant = pickAnteproyecto(eq.anteproyectos);
    const proyectos = (((ant?.proyectos ?? []) as any[]))
      .filter((p) => p.estado_seleccion !== 'archivado')
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
      .map((p) => ({
        id: p.id,
        nombre: p.nombre || '(sin nombre)',
        sector: p.sector ?? null,
        ciiu: p.ciiu ?? null,
        canvas_problema: p.canvas_problema ?? null,
        canvas_solucion: p.canvas_solucion ?? null,
      }));
    return { equipo_id: eq.id, nombre_equipo: eq.nombre_equipo ?? null, autores, proyectos };
  });

  res.json({ cohorte_id: cohorteId, total: filas.length, filas });
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

  // Antes haciamos un mega-SELECT con 4 niveles de embedding anidado que
  // colgaba el backend (120s timeout consistente, aunque la misma query
  // directa contra Supabase responde en <1s). Lo partimos en SELECTs
  // mas chicos en paralelo + un join en memoria — total <1s.
  const equiposRes = await supabaseAdmin
    .from('equipos')
    .select('id, nombre_equipo, tipo_trabajo_grado, buscando_socios, buscando_asociacion_otro_proyecto, director_id, directores:director_id(id, nombre_completo)')
    .eq('cohorte_id', cohorteId);
  if (equiposRes.error) return res.status(500).json({ error: equiposRes.error.message });

  const equipoIds = (equiposRes.data ?? []).map((e: any) => e.id);
  const [miembrosRes, antesRes, asignacionesRes] = equipoIds.length === 0
    ? [{ data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }]
    : await Promise.all([
        supabaseAdmin
          .from('miembros_equipo')
          .select('equipo_id, posicion, participantes_lista(nombre_completo)')
          .in('equipo_id', equipoIds),
        supabaseAdmin
          .from('anteproyectos')
          .select('id, equipo_id, estado, proyectos(id, posicion, nombre, sector, tipo, ciiu, canvas_problema, canvas_solucion, estado_seleccion)')
          .in('equipo_id', equipoIds),
        supabaseAdmin
          .from('asignaciones_profesor')
          .select('equipo_id, profesor_id, notificacion_enviada, profesores:profesor_id(id, nombre_completo)')
          .eq('cohorte_id', cohorteId),
      ]);

  // Indexar miembros, anteproyectos y asignaciones por equipo_id (join en memoria)
  const miembrosPorEquipo = new Map<string, any[]>();
  for (const m of (miembrosRes.data ?? []) as any[]) {
    const arr = miembrosPorEquipo.get(m.equipo_id) ?? [];
    arr.push(m);
    miembrosPorEquipo.set(m.equipo_id, arr);
  }
  const antePorEquipo = new Map<string, any>();
  for (const a of (antesRes.data ?? []) as any[]) {
    antePorEquipo.set(a.equipo_id, a);
  }
  const asigPorEquipo = new Map<string, any>();
  for (const a of (asignacionesRes.data ?? []) as any[]) {
    asigPorEquipo.set(a.equipo_id, a);
  }
  const equipos = (equiposRes.data ?? []).map((e: any) => ({
    ...e,
    miembros_equipo: miembrosPorEquipo.get(e.id) ?? [],
    anteproyectos: antePorEquipo.get(e.id) ?? null,
    asignaciones_profesor: asigPorEquipo.get(e.id) ? [asigPorEquipo.get(e.id)] : [],
  }));

  type Proyecto = {
    id: string;
    nombre: string;
    sector: string | null;
    tipo: string | null;
    ciiu: string | null;
    canvas_problema: string | null;
    canvas_solucion: string | null;
  };
  type Fila = {
    numero: number;
    equipo_id: string;
    nombre_equipo: string | null;
    autores: string;
    proyectos: Proyecto[];
    modalidad: string;
    buscando_socios: boolean | null;
    buscando_asociacion: boolean | null;
    profesor_asignado_id: string | null;
    profesor_asignado_nombre: string | null;
    director_asignado_nombre: string | null;
    comunicado: boolean;
  };
  const filas: Fila[] = [];

  for (const eq of (equipos as any[]) ?? []) {
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
    const asignacionRow = ((eq.asignaciones_profesor as any[]) ?? [])[0] ?? null;
    const asignacion = asignacionRow?.profesores ?? null;
    const directorNombre = (eq.directores as any)?.nombre_completo ?? null;

    let proyectos: Proyecto[] = [];
    if (modalidad === 'business_plan') {
      const ant = pickAnteproyecto(eq.anteproyectos);
      proyectos = ((ant?.proyectos ?? []) as any[])
        .filter((p) => p.estado_seleccion !== 'archivado')
        .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
        .map((p) => ({
          id: p.id,
          nombre: p.nombre || '(sin nombre)',
          sector: p.sector ?? null,
          tipo: p.tipo ?? null,
          ciiu: p.ciiu ?? null,
          canvas_problema: p.canvas_problema ?? null,
          canvas_solucion: p.canvas_solucion ?? null,
        }));
    }
    // Para caso/PI o BP sin proyectos: usamos un placeholder con el nombre del equipo
    if (!proyectos.length) {
      proyectos = [{
        id: '',
        nombre: eq.nombre_equipo || '(sin nombre)',
        sector: null,
        tipo: null,
        ciiu: null,
        canvas_problema: null,
        canvas_solucion: null,
      }];
    }

    filas.push({
      numero: 0,
      equipo_id: eq.id,
      nombre_equipo: eq.nombre_equipo ?? null,
      autores,
      proyectos,
      modalidad,
      buscando_socios: eq.buscando_socios ?? null,
      buscando_asociacion: eq.buscando_asociacion_otro_proyecto ?? null,
      profesor_asignado_id: asignacion?.id ?? null,
      profesor_asignado_nombre: asignacion?.nombre_completo ?? null,
      director_asignado_nombre: modalidad === 'business_plan' ? null : directorNombre,
      comunicado: !!asignacionRow?.notificacion_enviada,
    });
  }

  filas.forEach((f, i) => { f.numero = i + 1; });

  res.json({ cohorte_id: cohorteId, total: filas.length, filas });
});

/**
 * PATCH /api/sabana/equipos/:equipoId
 * Solo super_admin. Permite editar los flags de la sábana (socios /
 * asociación con otro proyecto) directamente desde la vista admin.
 */
const patchEquipoSchema = z.object({
  buscando_socios: z.boolean().nullable().optional(),
  buscando_asociacion_otro_proyecto: z.boolean().nullable().optional(),
  // profesor_id null = quitar asignacion. Solo aplica para equipos BP.
  profesor_id: z.string().uuid().nullable().optional(),
});
router.patch('/equipos/:equipoId', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const parsed = patchEquipoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  // Validar que el equipo exista y obtener su cohorte
  const { data: eq } = await supabaseAdmin
    .from('equipos').select('id, cohorte_id, tipo_trabajo_grado').eq('id', req.params.equipoId).maybeSingle();
  if (!eq) return res.status(404).json({ error: 'TEAM_NOT_FOUND' });

  // 1) Flags sobre equipos
  const patch: Record<string, unknown> = {};
  if (parsed.data.buscando_socios !== undefined) patch.buscando_socios = parsed.data.buscando_socios;
  if (parsed.data.buscando_asociacion_otro_proyecto !== undefined) patch.buscando_asociacion_otro_proyecto = parsed.data.buscando_asociacion_otro_proyecto;
  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from('equipos').update(patch).eq('id', req.params.equipoId);
    if (error) return res.status(500).json({ error: error.message });
  }

  // 2) Asignación de profesor (solo BP)
  if (parsed.data.profesor_id !== undefined) {
    const equipoId = req.params.equipoId;
    if (parsed.data.profesor_id === null) {
      // Quitar asignación
      const { error } = await supabaseAdmin.from('asignaciones_profesor').delete().eq('equipo_id', equipoId);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      // Asignar / reemplazar. Si super_admin no tiene profesor_id, usamos el profesor mismo como asignado_por.
      const asignadoPor = req.user!.profesorId ?? parsed.data.profesor_id;
      // ¿Cambió el profesor respecto al ya asignado? Si es nuevo o distinto,
      // se marca como pendiente de notificar (notificacion_enviada=false) para
      // que el próximo "Comunicar" envíe el aviso. Si es el mismo profesor,
      // preservamos el estado de notificación para no re-enviar correos.
      const { data: prev, error: errPrev } = await supabaseAdmin
        .from('asignaciones_profesor')
        .select('profesor_id, notificacion_enviada, fecha_notificacion')
        .eq('equipo_id', equipoId)
        .maybeSingle();
      // Si falla la lectura del estado previo, abortamos en vez de resetear
      // notificacion_enviada por error y re-notificar una asignación ya enviada.
      if (errPrev) return res.status(500).json({ error: errPrev.message });
      const cambioProfesor = !prev || (prev as any).profesor_id !== parsed.data.profesor_id;
      const { error } = await supabaseAdmin
        .from('asignaciones_profesor')
        .upsert({
          equipo_id: equipoId,
          profesor_id: parsed.data.profesor_id,
          cohorte_id: (eq as any).cohorte_id,
          asignado_por: asignadoPor,
          notificacion_enviada: cambioProfesor ? false : (prev as any).notificacion_enviada,
          fecha_notificacion: cambioProfesor ? null : (prev as any).fecha_notificacion,
        }, { onConflict: 'equipo_id' });
      if (error) return res.status(500).json({ error: error.message });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('equipos').select('id, buscando_socios, buscando_asociacion_otro_proyecto').eq('id', req.params.equipoId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
